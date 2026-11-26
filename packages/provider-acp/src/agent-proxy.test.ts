import { createServer } from "node:http";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { initializeAcpAgentProxy } from "./agent-proxy.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

it("ACP agent应用启动快照而非重新读取配置，HTTP认证与fetch使用同一出口", async () => {
  const server = createServer();
  let authorization: string | undefined;
  server.on("connect", (request, socket) => {
    authorization = request.headers["proxy-authorization"];
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    socket.once("data", () =>
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nproxied"),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("缺少测试代理端口");
  vi.stubEnv(
    "CODEXLY_NETWORK_PROXY_SNAPSHOT",
    JSON.stringify({
      mode: "custom",
      protocol: "http",
      host: "127.0.0.1",
      port: address.port,
      username: "user",
      password: "secret",
    }),
  );
  vi.stubEnv("NO_PROXY", "*");
  const input = new PassThrough();
  const proxy = await initializeAcpAgentProxy(input);
  try {
    expect(process.env["CODEXLY_NETWORK_PROXY_SNAPSHOT"]).toBeUndefined();
    expect(
      await (
        await fetch("http://destination.invalid/resource", { signal: AbortSignal.timeout(3000) })
      ).text(),
    ).toBe("proxied");
    expect(authorization).toBe(`Basic ${Buffer.from("user:secret").toString("base64")}`);
    expect(proxy.close()).toBe(proxy.close());
  } finally {
    await proxy.close();
    input.destroy();
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
  }
});

it("ACP直连覆盖继承变量，EOF后恢复fetch并释放监听，重复关闭安全", async () => {
  const previousFetch = globalThis.fetch;
  vi.stubEnv("HTTPS_PROXY", "http://invalid.invalid:8080");
  vi.stubEnv(
    "CODEXLY_NETWORK_PROXY_SNAPSHOT",
    JSON.stringify({ mode: "direct", protocol: "http", host: "", port: 8080, username: "" }),
  );
  const input = new PassThrough();
  const proxy = await initializeAcpAgentProxy(input);
  expect(proxy.env["HTTPS_PROXY"]).toBe("");
  expect(globalThis.fetch).not.toBe(previousFetch);
  input.resume();
  input.end();
  await once(input, "end");
  await proxy.close();
  expect(globalThis.fetch).toBe(previousFetch);
  expect(input.listenerCount("end")).toBe(0);
  expect(input.listenerCount("close")).toBe(0);
});

it("无效启动快照明确失败且不泄露凭据", async () => {
  vi.stubEnv("CODEXLY_NETWORK_PROXY_SNAPSHOT", '{"password":"secret",broken}');
  await expect(initializeAcpAgentProxy(new PassThrough())).rejects.toThrow(
    "ACP_NETWORK_PROXY_INVALID",
  );
  expect(process.env["CODEXLY_NETWORK_PROXY_SNAPSHOT"]).toBeUndefined();
});
