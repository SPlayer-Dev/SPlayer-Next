import { randomBytes } from "node:crypto";
import { lookup } from "node:dns";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { connect, type Socket, type TcpNetConnectOpts } from "node:net";
import type { Duplex } from "node:stream";
import { SocksClient } from "socks";

export interface GatewayOptions {
  resolveProxy: (url: string) => Promise<string[]>;
  lookup?: typeof lookup;
  onConnect?: (host: string, socket: Socket, proxied: boolean) => void;
  onError?: (host: string, error: unknown) => void;
}

export const GATEWAY_CHECK_URL = "http://splayer-connection-check.invalid/";

/** 将 Chromium 和原生音频的 TCP 连接交给 Node，统一地址族选择，HTTPS 仍为端到端隧道。 */
export class ConnectionGateway {
  readonly username = "splayer";
  readonly password = randomBytes(24).toString("hex");
  private readonly authorization = `Basic ${Buffer.from(`${this.username}:${this.password}`).toString("base64")}`;
  private readonly sockets = new Set<Socket>();
  private readonly server = http.createServer();
  private readonly agent = new http.Agent({
    keepAlive: true,
    maxSockets: 64,
    maxTotalSockets: 128,
    maxFreeSockets: 4,
    timeout: 30_000,
  });
  private stopped = false;
  private generation = 0;
  port = 0;

  constructor(private readonly options: GatewayOptions) {
    this.server.maxConnections = 128;
    this.server.headersTimeout = 10_000;
    this.server.requestTimeout = 0;
    this.agent.createConnection = (options, callback) => {
      const host = String(options.host);
      const port = Number(options.port);
      const authority = host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
      void this.open(host, port, `http://${authority}`).then(
        (socket) => callback?.(null, socket),
        (error: Error) => callback?.(error, undefined as never),
      );
      return undefined as never;
    };
    this.server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.once("close", () => this.sockets.delete(socket));
    });
    this.server.on("request", async (request, response) => {
      if (request.headers["proxy-authorization"] !== this.authorization) {
        response.writeHead(407, { "Proxy-Authenticate": 'Basic realm="SPlayer"' });
        response.end();
        return;
      }
      if (request.url === GATEWAY_CHECK_URL) {
        response.writeHead(204).end();
        return;
      }
      let url: URL;
      try {
        url = new URL(request.url!);
        if (url.protocol !== "http:") throw new Error("仅接受 HTTP 请求或 CONNECT 隧道");
      } catch {
        response.writeHead(400).end();
        return;
      }
      let upstream: http.ClientRequest;
      const generation = this.generation;
      try {
        const headers = { ...request.headers, host: url.host };
        delete headers["proxy-authorization"];
        delete headers["proxy-connection"];
        const [route] = await this.options.resolveProxy(url.href);
        if (request.destroyed || response.destroyed || generation !== this.generation) return;
        if (route?.startsWith("http://") || route?.startsWith("https://")) {
          // 普通 HTTP 使用代理的绝对 URL 请求，兼容禁止 CONNECT 到 80 端口的代理。
          const proxy = new URL(route);
          if (proxy.username || proxy.password) {
            headers["proxy-authorization"] =
              `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}`;
          }
          proxy.username = "";
          proxy.password = "";
          // HTTP 会透传 TCP 连接选项，但 Node 的 HTTP 类型尚未声明地址族选项。
          const requestOptions: http.RequestOptions & Pick<TcpNetConnectOpts, "autoSelectFamily"> =
            {
              method: request.method,
              path: url.href,
              headers,
              agent: false,
              lookup: this.options.lookup ?? lookup,
              autoSelectFamily: true,
            };
          upstream = (proxy.protocol === "https:" ? https : http).request(proxy, requestOptions);
          upstream.on("socket", (socket) => {
            this.sockets.add(socket);
            socket.once("close", () => this.sockets.delete(socket));
            if (socket.connecting)
              socket.once("connect", () => this.options.onConnect?.(url.hostname, socket, true));
          });
        } else {
          upstream = http.request(url, {
            method: request.method,
            headers,
            agent: this.agent,
          });
        }
      } catch (error) {
        this.options.onError?.(url.hostname, error);
        response.writeHead(502).end();
        return;
      }
      upstream.on("response", (incoming) => {
        response.writeHead(incoming.statusCode!, incoming.headers);
        incoming.on("error", () => response.destroy());
        incoming.pipe(response);
      });
      upstream.on("error", (error) => {
        this.options.onError?.(url.hostname, error);
        if (!response.headersSent) response.writeHead(502);
        response.end();
      });
      response.on("close", () => upstream.destroy());
      request.on("error", () => upstream.destroy());
      request.pipe(upstream);
    });
    this.server.on("connect", (request, socket, head) => {
      void this.tunnel(request, socket, head, true);
    });
    this.server.on("upgrade", (request, socket, head) => {
      void this.tunnel(request, socket, head, false);
    });
  }

  /** 仅监听 IPv4 回环地址，不向局域网提供代理。 */
  async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.off("error", reject);
        this.port = (this.server.address() as { port: number }).port;
        resolve();
      });
    });
  }

  get url(): string {
    return `http://${this.username}:${this.password}@127.0.0.1:${this.port}`;
  }

  /** 销毁连接和监听器，取消尚在建立的连接。 */
  close(): void {
    this.stopped = true;
    this.resetConnections();
    this.server.close();
  }

  /** 切换连接设置时取消旧请求，禁止复用旧代理的连接。 */
  resetConnections(): void {
    this.generation++;
    this.agent.destroy();
    for (const socket of this.sockets) socket.destroy();
  }

  private async open(host: string, port: number, url: string): Promise<Socket> {
    const generation = this.generation;
    const routes = await this.options.resolveProxy(url);
    let lastError: unknown = new Error("没有可用的代理路由");
    for (const route of routes) {
      try {
        const socket = await this.connectRoute(host, port, route);
        if (this.stopped || generation !== this.generation) {
          socket.destroy();
          throw new Error("连接策略已变更或连接层已关闭");
        }
        this.options.onConnect?.(host, socket, route !== "DIRECT");
        socket.on("error", () => socket.destroy());
        this.sockets.add(socket);
        socket.once("close", () => this.sockets.delete(socket));
        return socket;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  private async connectRoute(host: string, port: number, route: string): Promise<Socket> {
    const socketOptions = { lookup: this.options.lookup ?? lookup, autoSelectFamily: true };
    if (route === "DIRECT") {
      return await new Promise<Socket>((resolve, reject) => {
        const socket = connect({ host, port, ...socketOptions });
        const timer = setTimeout(() => socket.destroy(new Error("连接超时")), 8000);
        socket.once("error", reject);
        socket.once("close", () => clearTimeout(timer));
        socket.once("connect", () => {
          clearTimeout(timer);
          socket.off("error", reject);
          resolve(socket);
        });
      });
    }
    const proxy = new URL(route);
    if (proxy.protocol.startsWith("socks")) {
      const result = await SocksClient.createConnection({
        command: "connect",
        proxy: {
          host: proxy.hostname.replace(/^\[|\]$/g, ""),
          port: Number(proxy.port || 1080),
          type: proxy.protocol.startsWith("socks4") ? 4 : 5,
          userId: decodeURIComponent(proxy.username),
          password: decodeURIComponent(proxy.password),
        },
        destination: { host, port },
        timeout: 8000,
        socket_options: { ...socketOptions, port: Number(proxy.port || 1080) },
      });
      return result.socket;
    }
    if (proxy.protocol !== "http:" && proxy.protocol !== "https:") {
      throw new Error(`不支持的代理协议: ${proxy.protocol}`);
    }
    return await new Promise<Socket>((resolve, reject) => {
      const authority = host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
      const headers: Record<string, string> = { Host: authority };
      if (proxy.username || proxy.password) {
        headers["Proxy-Authorization"] =
          `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}`;
      }
      proxy.username = "";
      proxy.password = "";
      const request = (proxy.protocol === "https:" ? https : http).request(proxy, {
        method: "CONNECT",
        path: authority,
        headers,
        agent: false,
        ...socketOptions,
      });
      const timer = setTimeout(() => request.destroy(new Error("代理连接超时")), 8000);
      request.once("error", reject);
      request.once("close", () => clearTimeout(timer));
      request.once("connect", (response, socket, head) => {
        clearTimeout(timer);
        if (response.statusCode !== 200) {
          socket.destroy();
          reject(new Error(`代理 CONNECT 返回 ${response.statusCode}`));
          return;
        }
        if (head.length) socket.unshift(head);
        resolve(socket);
      });
      request.end();
    });
  }

  private async tunnel(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    connectMethod: boolean,
  ): Promise<void> {
    let targetHost = "unknown";
    socket.on("error", () => socket.destroy());
    if (request.headers["proxy-authorization"] !== this.authorization) {
      socket.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="SPlayer"\r\nContent-Length: 0\r\n\r\n',
      );
      return;
    }
    try {
      const url = new URL(connectMethod ? `https://${request.url}` : request.url!);
      const host = url.hostname.replace(/^\[|\]$/g, "");
      targetHost = host;
      const upstream = await this.open(
        host,
        Number(url.port || (connectMethod ? 443 : 80)),
        url.href,
      );
      if (socket.destroyed) {
        upstream.destroy();
        return;
      }
      socket.once("close", () => upstream.destroy());
      upstream.once("close", () => socket.destroy());
      if (connectMethod) {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      } else {
        const headers = { ...request.headers, host: url.host };
        delete headers["proxy-authorization"];
        delete headers["proxy-connection"];
        upstream.write(
          `${request.method} ${url.pathname}${url.search} HTTP/1.1\r\n${Object.entries(headers)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\r\n")}\r\n\r\n`,
        );
      }
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    } catch (error) {
      this.options.onError?.(targetHost, error);
      if (!socket.destroyed) socket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
    }
  }
}
