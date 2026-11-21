/**
 * 会话总线最小编解码实现
 * 只覆盖托盘宿主检测所需的方法调用与信号订阅，避免为单个功能引入运行时依赖
 */

/** 消息类型 */
export const MESSAGE_TYPE = {
  methodCall: 1,
  methodReturn: 2,
  error: 3,
  signal: 4,
} as const;

/** 头部字段编号 */
const FIELD = {
  path: 1,
  interface: 2,
  member: 3,
  errorName: 4,
  replySerial: 5,
  destination: 6,
  signature: 8,
} as const;

/** 小端字节序标记 */
const LITTLE_ENDIAN = 0x6c;

/** 固定头部长度：字节序、类型、标志、版本、消息体长度、序列号、字段数组长度 */
const FIXED_HEADER_LENGTH = 16;

/** 解析后的总线消息 */
export interface DbusMessage {
  type: number;
  serial: number;
  replySerial?: number;
  errorName?: string;
  interface?: string;
  member?: string;
  body: unknown[];
}

/** 方法调用头部字段 */
export interface MessageHeader {
  destination?: string;
  path?: string;
  iface?: string;
  member?: string;
  signature?: string;
}

/**
 * 消息写入器，按 D-Bus 对齐规则追加字节
 */
export class MessageWriter {
  private readonly chunks: Buffer[] = [];
  private size = 0;

  /**
   * 按对齐要求补零
   * @param alignment - 对齐字节数
   */
  pad(alignment: number): void {
    const rest = this.size % alignment;
    if (rest !== 0) this.append(Buffer.alloc(alignment - rest));
  }

  /**
   * 写入单字节
   * @param value - 字节值
   */
  writeByte(value: number): void {
    this.append(Buffer.from([value]));
  }

  /**
   * 写入 32 位无符号整数
   * @param value - 整数值
   */
  writeUint32(value: number): void {
    this.pad(4);
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(value);
    this.append(buf);
  }

  /**
   * 写入字符串，格式为长度前缀、内容、结尾 0
   * @param value - 字符串内容
   */
  writeString(value: string): void {
    this.pad(4);
    const body = Buffer.from(value, "utf8");
    this.writeUint32(body.length);
    this.append(body);
    this.append(Buffer.from([0]));
  }

  /**
   * 写入类型签名，格式为长度字节、内容、结尾 0
   * @param value - 签名内容
   */
  writeSignature(value: string): void {
    const body = Buffer.from(value, "ascii");
    this.append(Buffer.from([body.length]));
    this.append(body);
    this.append(Buffer.from([0]));
  }

  /**
   * 写入变体，格式为签名加对齐后的值
   * @param signature - 值签名
   * @param writeValue - 值写入回调
   */
  writeVariant(signature: string, writeValue: (writer: MessageWriter) => void): void {
    this.writeSignature(signature);
    writeValue(this);
  }

  /**
   * 追加原始字节
   * @param buf - 字节内容
   */
  writeRaw(buf: Buffer): void {
    this.append(buf);
  }

  /**
   * 取出已写入的全部内容
   * @returns 完整缓冲区
   */
  toBuffer(): Buffer {
    return Buffer.concat(this.chunks, this.size);
  }

  /**
   * 追加内容并累计长度
   * @param buf - 待追加的字节
   */
  private append(buf: Buffer): void {
    this.chunks.push(buf);
    this.size += buf.length;
  }
}

/**
 * 消息读取器，按 D-Bus 对齐规则顺序解析
 */
class MessageReader {
  private offset: number;

  constructor(
    private readonly buf: Buffer,
    start = 0,
  ) {
    this.offset = start;
  }

  /** 当前读取位置 */
  get position(): number {
    return this.offset;
  }

  /**
   * 按对齐要求移动到边界
   * @param alignment - 对齐字节数
   */
  pad(alignment: number): void {
    this.offset = (this.offset + alignment - 1) & ~(alignment - 1);
  }

  /**
   * 读取单字节
   * @returns 字节值
   */
  readByte(): number {
    return this.buf[this.offset++] ?? 0;
  }

  /**
   * 读取 32 位无符号整数
   * @returns 整数值
   */
  readUint32(): number {
    this.pad(4);
    const value = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  /**
   * 读取布尔值
   * @returns 布尔值
   */
  readBoolean(): boolean {
    return this.readUint32() !== 0;
  }

  /**
   * 读取字符串
   * @returns 字符串内容
   */
  readString(): string {
    this.pad(4);
    const length = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    const value = this.buf.toString("utf8", this.offset, this.offset + length);
    this.offset += length + 1;
    return value;
  }

  /**
   * 读取类型签名
   * @returns 签名内容
   */
  readSignature(): string {
    const length = this.buf[this.offset++] ?? 0;
    const value = this.buf.toString("ascii", this.offset, this.offset + length);
    this.offset += length + 1;
    return value;
  }

  /**
   * 按签名读取单个值
   * @param signature - 单字符类型签名
   * @returns 读取结果
   */
  readValue(signature: string): unknown {
    switch (signature) {
      case "s":
      case "o":
        return this.readString();
      case "g":
        return this.readSignature();
      case "b":
        return this.readBoolean();
      case "u":
        return this.readUint32();
      case "v":
        return this.readVariant();
      default:
        throw new Error(`不支持的 D-Bus 类型 ${signature}`);
    }
  }

  /**
   * 读取变体，返回其内部值
   * @returns 变体内部的值
   */
  readVariant(): unknown {
    return this.readValue(this.readSignature());
  }

  /**
   * 按签名串连续读取多个值
   * @param signature - 类型签名串
   * @returns 值列表
   */
  readValues(signature: string): unknown[] {
    return [...signature].map((item) => this.readValue(item));
  }
}

/**
 * 计算单条消息的总长度
 * @param buf - 现有缓冲区
 * @returns 总长度，头部尚未收全时返回 0
 */
export const frameLength = (buf: Buffer): number => {
  if (buf.length < FIXED_HEADER_LENGTH) return 0;
  if (buf[0] !== LITTLE_ENDIAN) throw new Error("仅支持小端字节序的总线消息");
  const bodyLength = buf.readUInt32LE(4);
  const fieldsLength = buf.readUInt32LE(12);
  const bodyStart = (FIXED_HEADER_LENGTH + fieldsLength + 7) & ~7;
  return bodyStart + bodyLength;
};

/**
 * 解析完整的消息字节
 * @param raw - 单条消息的原始字节
 * @returns 解析结果
 */
export const parseMessage = (raw: Buffer): DbusMessage => {
  const reader = new MessageReader(raw, 4);
  reader.readUint32();
  const serial = reader.readUint32();
  const fieldsLength = reader.readUint32();
  const fieldsEnd = reader.position + fieldsLength;
  let iface: string | undefined;
  let member: string | undefined;
  let errorName: string | undefined;
  let replySerial: number | undefined;
  let signature = "";

  while (reader.position < fieldsEnd) {
    reader.pad(8);
    const code = reader.readByte();
    const value = reader.readVariant();
    if (code === FIELD.interface) iface = String(value);
    else if (code === FIELD.member) member = String(value);
    else if (code === FIELD.errorName) errorName = String(value);
    else if (code === FIELD.signature) signature = String(value);
    else if (code === FIELD.replySerial) replySerial = Number(value);
  }

  const bodyStart = (FIXED_HEADER_LENGTH + fieldsLength + 7) & ~7;
  return {
    type: raw[1] ?? 0,
    serial,
    replySerial,
    errorName,
    interface: iface,
    member,
    body: signature ? new MessageReader(raw, bodyStart).readValues(signature) : [],
  };
};

/**
 * 构建待发送的消息字节
 * @param type - 消息类型
 * @param serial - 序列号
 * @param header - 头部字段
 * @param writeBody - 消息体写入回调
 * @returns 完整消息字节
 */
export const buildMessage = (
  type: number,
  serial: number,
  header: MessageHeader,
  writeBody?: (writer: MessageWriter) => void,
): Buffer => {
  const body = new MessageWriter();
  writeBody?.(body);
  const bodyBytes = body.toBuffer();

  const fields = new MessageWriter();
  const addField = (code: number, signature: string, value: string): void => {
    fields.pad(8);
    fields.writeByte(code);
    fields.writeVariant(signature, (writer) => writer.writeString(value));
  };
  if (header.path) addField(FIELD.path, "o", header.path);
  if (header.iface) addField(FIELD.interface, "s", header.iface);
  if (header.member) addField(FIELD.member, "s", header.member);
  if (header.destination) addField(FIELD.destination, "s", header.destination);
  if (header.signature) {
    fields.pad(8);
    fields.writeByte(FIELD.signature);
    fields.writeVariant("g", (writer) => writer.writeSignature(header.signature!));
  }
  const fieldsBytes = fields.toBuffer();

  const head = new MessageWriter();
  head.writeByte(LITTLE_ENDIAN);
  head.writeByte(type);
  head.writeByte(0);
  head.writeByte(1);
  head.writeUint32(bodyBytes.length);
  head.writeUint32(serial);
  head.writeUint32(fieldsBytes.length);
  head.writeRaw(fieldsBytes);
  head.pad(8);
  return Buffer.concat([head.toBuffer(), bodyBytes]);
};
