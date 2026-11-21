import { connect, type Socket } from "node:net";
import {
  buildMessage,
  frameLength,
  MESSAGE_TYPE,
  parseMessage,
  type DbusMessage,
  type MessageWriter,
} from "./codec";

/** 方法调用超时毫秒数，对端不响应时按失败处理 */
const CALL_TIMEOUT_MS = 2000;

/** 待响应的方法调用 */
interface PendingCall {
  resolve: (body: unknown[]) => void;
  reject: (error: Error) => void;
}

/**
 * 解析 unix 型总线地址
 * @param address - 地址串，例如 unix:path=/run/user/1000/bus
 * @returns 套接字连接参数
 */
const parseAddress = (address: string): { path: string } => {
  const unix = address.split(";").find((item) => item.startsWith("unix:"));
  if (!unix) throw new Error(`不支持的总线地址 ${address}`);
  const params = new Map(
    unix
      .slice("unix:".length)
      .split(",")
      .map((item) => {
        const index = item.indexOf("=");
        return [item.slice(0, index), decodeURIComponent(item.slice(index + 1))] as const;
      }),
  );
  const socketPath = params.get("path");
  if (socketPath) return { path: socketPath };
  const abstract = params.get("abstract");
  if (abstract) return { path: `\0${abstract}` };
  throw new Error(`不支持的 unix 总线地址 ${unix}`);
};

/**
 * 读取一行认证响应
 * @param socket - 总线套接字
 * @returns 首个换行符之前的内容
 */
const readLine = (socket: Socket): Promise<string> =>
  new Promise((resolve, reject) => {
    let received = "";
    const onData = (chunk: Buffer): void => {
      received += chunk.toString("utf8");
      const end = received.indexOf("\r\n");
      if (end === -1) return;
      detach();
      resolve(received.slice(0, end));
    };
    const onError = (error: Error): void => {
      detach();
      reject(error);
    };
    const detach = (): void => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });

/**
 * 建立 socket 连接
 * @param address - 总线地址串
 * @returns 已连接的总线套接字
 */
const openSocket = (address: string): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const socket = connect(parseAddress(address));
    const onError = (error: Error): void => {
      socket.off("connect", onConnect);
      reject(error);
    };
    const onConnect = (): void => {
      socket.off("error", onError);
      resolve(socket);
    };
    socket.on("error", onError);
    socket.on("connect", onConnect);
  });

/**
 * 完成 EXTERNAL 认证
 * @param socket - 已连接的总线套接字
 */
const authenticate = async (socket: Socket): Promise<void> => {
  const uid = typeof process.getuid === "function" ? process.getuid() : -1;
  // EXTERNAL 的身份是十进制 UID 字符串再转十六进制
  const identity = Buffer.from(String(uid), "ascii").toString("hex");
  socket.write(
    Buffer.concat([Buffer.from([0]), Buffer.from(`AUTH EXTERNAL ${identity}\r\n`, "ascii")]),
  );
  const reply = await readLine(socket);
  if (!reply.startsWith("OK")) throw new Error(`总线认证失败 ${reply}`);
  socket.write("BEGIN\r\n");
};

/**
 * 会话总线连接
 */
export class SessionBus {
  private readonly socket: Socket;
  private readonly pending = new Map<number, PendingCall>();
  private readonly signalHandlers = new Set<(message: DbusMessage) => void>();
  private readonly closeHandlers = new Set<() => void>();
  private incoming: Buffer = Buffer.alloc(0);
  private serial = 0;
  private closed = false;

  private constructor(socket: Socket) {
    this.socket = socket;
    socket.on("data", (chunk: Buffer) => this.handleData(chunk));
    socket.on("error", () => this.handleClose());
    socket.on("close", () => this.handleClose());
  }

  /**
   * 连接并认证会话总线
   * @param address - 总线地址，默认取 DBUS_SESSION_BUS_ADDRESS
   * @returns 可用的总线连接
   */
  static async connect(address = process.env["DBUS_SESSION_BUS_ADDRESS"]): Promise<SessionBus> {
    if (!address) throw new Error("缺少 DBUS_SESSION_BUS_ADDRESS");
    const socket = await openSocket(address);
    await authenticate(socket);
    const bus = new SessionBus(socket);
    await bus.call(
      "org.freedesktop.DBus",
      "/org/freedesktop/DBus",
      "org.freedesktop.DBus",
      "Hello",
    );
    return bus;
  }

  /**
   * 发起方法调用
   * @param destination - 目标总线名
   * @param path - 对象路径
   * @param iface - 接口名
   * @param member - 方法名
   * @param signature - 参数类型签名
   * @param writeBody - 参数写入回调
   * @returns 方法返回值列表
   */
  call(
    destination: string,
    path: string,
    iface: string,
    member: string,
    signature = "",
    writeBody?: (writer: MessageWriter) => void,
  ): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error("总线连接已关闭"));
        return;
      }
      const serial = ++this.serial;
      const timer = setTimeout(() => {
        this.pending.delete(serial);
        reject(new Error(`总线调用超时 ${member}`));
      }, CALL_TIMEOUT_MS);
      timer.unref();
      this.pending.set(serial, {
        resolve: (body) => {
          clearTimeout(timer);
          resolve(body);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.socket.write(
        buildMessage(
          MESSAGE_TYPE.methodCall,
          serial,
          { destination, path, iface, member, signature },
          writeBody,
        ),
      );
    });
  }

  /**
   * 添加信号匹配规则
   * @param rule - D-Bus 匹配规则
   */
  async match(rule: string): Promise<void> {
    await this.call(
      "org.freedesktop.DBus",
      "/org/freedesktop/DBus",
      "org.freedesktop.DBus",
      "AddMatch",
      "s",
      (writer) => writer.writeString(rule),
    );
  }

  /**
   * 判断总线名是否已有持有者
   * @param name - 总线名
   * @returns 是否已被占用
   */
  async nameHasOwner(name: string): Promise<boolean> {
    const [owned] = await this.call(
      "org.freedesktop.DBus",
      "/org/freedesktop/DBus",
      "org.freedesktop.DBus",
      "NameHasOwner",
      "s",
      (writer) => writer.writeString(name),
    );
    return owned === true;
  }

  /**
   * 读取布尔类型属性
   * @param busName - 目标总线名
   * @param path - 对象路径
   * @param iface - 接口名
   * @param property - 属性名
   * @returns 属性值，读取失败或类型不符时为 undefined
   */
  async getBoolProperty(
    busName: string,
    path: string,
    iface: string,
    property: string,
  ): Promise<boolean | undefined> {
    try {
      const [value] = await this.call(
        busName,
        path,
        "org.freedesktop.DBus.Properties",
        "Get",
        "ss",
        (writer) => {
          writer.writeString(iface);
          writer.writeString(property);
        },
      );
      return typeof value === "boolean" ? value : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * 订阅总线信号
   * @param handler - 信号回调
   * @returns 取消订阅的函数
   */
  onSignal(handler: (message: DbusMessage) => void): () => void {
    this.signalHandlers.add(handler);
    return () => this.signalHandlers.delete(handler);
  }

  /**
   * 订阅连接关闭事件
   * @param handler - 关闭回调
   * @returns 取消订阅的函数
   */
  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  /** 关闭连接 */
  close(): void {
    if (this.closed) return;
    this.socket.destroy();
    this.handleClose();
  }

  /**
   * 处理套接字数据，按帧切分后分派
   * @param chunk - 新增字节
   */
  private handleData(chunk: Buffer): void {
    this.incoming = this.incoming.length === 0 ? chunk : Buffer.concat([this.incoming, chunk]);
    try {
      while (!this.closed) {
        const length = frameLength(this.incoming);
        if (length === 0 || this.incoming.length < length) return;
        const raw = this.incoming.subarray(0, length);
        this.incoming = this.incoming.subarray(length);
        this.dispatch(parseMessage(raw));
      }
    } catch {
      this.close();
    }
  }

  /**
   * 分派消息到挂起调用或信号处理器
   * @param message - 解析后的消息
   */
  private dispatch(message: DbusMessage): void {
    if (message.type === MESSAGE_TYPE.signal) {
      for (const handler of this.signalHandlers) handler(message);
      return;
    }
    const pending =
      message.replySerial === undefined ? undefined : this.pending.get(message.replySerial);
    if (!pending || message.replySerial === undefined) return;
    this.pending.delete(message.replySerial);
    if (message.type === MESSAGE_TYPE.error) {
      pending.reject(new Error(message.errorName ?? "总线调用失败"));
      return;
    }
    pending.resolve(message.body);
  }

  /** 处理连接结束 */
  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    const error = new Error("总线连接已关闭");
    for (const call of this.pending.values()) call.reject(error);
    this.pending.clear();
    for (const handler of this.closeHandlers) handler();
    this.closeHandlers.clear();
  }
}
