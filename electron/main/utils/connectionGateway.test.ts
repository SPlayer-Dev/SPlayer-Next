import assert from "node:assert/strict";
import { getDefaultResultOrder, setDefaultResultOrder } from "node:dns";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import { afterEach, describe, it } from "node:test";
import { ConnectionGateway } from "./connectionGateway";

const order = getDefaultResultOrder();
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
  setDefaultResultOrder(order);
});

/** 启动双栈目标服务，通过服务端看到的地址验证实际连接的地址族。 */
const target = async (host = "::") => {
  const addresses: string[] = [];
  const ranges: string[] = [];
  const server = http.createServer((request, response) => {
    addresses.push(request.socket.remoteAddress!);
    ranges.push(request.headers.range ?? "");
    if (request.url === "/redirect") {
      response.writeHead(302, { Location: "/audio" }).end();
      return;
    }
    response.writeHead(206, { "Content-Range": "bytes 2-5/8", "Content-Length": 4 });
    response.end(Buffer.from([0, 1, 254, 255]));
  });
  server.listen({ port: 0, host, ipv6Only: host === "::1" });
  await once(server, "listening");
  cleanup.push(() => {
    server.closeAllConnections();
    server.close();
  });
  return { server, port: (server.address() as net.AddressInfo).port, addresses, ranges };
};

const gateway = async (route = "DIRECT") => {
  const instance = new ConnectionGateway({ resolveProxy: async () => [route] });
  await instance.listen();
  cleanup.push(() => instance.close());
  return instance;
};

/** 以真正的 HTTP 代理请求访问目标，不使用 fetch 的测试替身。 */
const request = async (proxy: ConnectionGateway, url: string, authenticated = true) => {
  return await new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>(
    (resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: proxy.port,
          path: url,
          headers: {
            Range: "bytes=2-5",
            ...(authenticated
              ? {
                  "Proxy-Authorization": `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64")}`,
                }
              : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("error", reject);
          res.on("end", () =>
            resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    },
  );
};

describe("所有网络栈共用的连接层", () => {
  it("双栈目标首先连接 IPv4，Range 与二进制响应保持完整", async () => {
    setDefaultResultOrder("ipv4first");
    const origin = await target();
    const proxy = await gateway();
    const result = await request(proxy, `http://localhost:${origin.port}/audio`);
    assert.equal(result.status, 206);
    assert.equal(result.headers["content-range"], "bytes 2-5/8");
    assert.deepEqual(result.body, Buffer.from([0, 1, 254, 255]));
    assert.deepEqual(origin.ranges, ["bytes=2-5"]);
    assert.deepEqual(origin.addresses, ["::ffff:127.0.0.1"]);
  });

  it("IPv4 端口不可达时可以回退到 IPv6", async () => {
    setDefaultResultOrder("ipv4first");
    const origin = await target("::1");
    const result = await request(await gateway(), `http://localhost:${origin.port}/audio`);
    assert.equal(result.status, 206);
    assert.deepEqual(origin.addresses, ["::1"]);
  });

  it("仍支持显式 IPv6 地址与重定向响应", async () => {
    setDefaultResultOrder("ipv4first");
    const origin = await target("::1");
    const result = await request(await gateway(), `http://[::1]:${origin.port}/redirect`);
    assert.equal(result.status, 302);
    assert.equal(result.headers.location, "/audio");
  });

  it("拒绝没有应用凭据的请求，不访问目标服务", async () => {
    const origin = await target();
    const result = await request(await gateway(), `http://localhost:${origin.port}/audio`, false);
    assert.equal(result.status, 407);
    assert.deepEqual(origin.addresses, []);
  });

  it("经已配置的 HTTP 代理建立连接，并保留代理认证", async () => {
    setDefaultResultOrder("ipv4first");
    const origin = await target();
    const upstream = await gateway();
    const proxy = await gateway(upstream.url);
    const result = await request(proxy, `http://localhost:${origin.port}/audio`);
    assert.equal(result.status, 206);
    assert.deepEqual(origin.addresses, ["::ffff:127.0.0.1"]);
  });

  it("CONNECT 隧道逐字节转发，客户端断开会释放远端连接", async () => {
    const sockets = new Set<net.Socket>();
    const echo = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {});
      socket.pipe(socket);
    });
    echo.listen(0, "127.0.0.1");
    await once(echo, "listening");
    cleanup.push(() => {
      for (const socket of sockets) socket.destroy();
      echo.close();
    });
    const proxy = await gateway();
    const req = http.request({
      host: "127.0.0.1",
      port: proxy.port,
      method: "CONNECT",
      path: `localhost:${(echo.address() as net.AddressInfo).port}`,
      headers: {
        "Proxy-Authorization": `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64")}`,
      },
    });
    req.end();
    const [res, socket] = (await once(req, "connect")) as [
      http.IncomingMessage,
      net.Socket,
      Buffer,
    ];
    assert.equal(res.statusCode, 200);
    const bytes = Buffer.from([0x16, 0x03, 0x01, 0, 255]);
    socket.write(bytes);
    const [received] = await once(socket, "data");
    assert.deepEqual(received, bytes);
    const remoteClosed = once([...sockets][0], "close");
    socket.destroy();
    await remoteClosed;
    assert.equal(sockets.size, 0);
  });
});
