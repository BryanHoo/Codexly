import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { readNetworkProxy, saveNetworkProxy, proxyEnvironment } from "./network-proxy.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
it("保存并重开配置，读取时隐藏密码，省略密码保留而空值清除", async () => {
  const root = await mkdtemp(join(tmpdir(), "proxy-"));
  roots.push(root);
  const input = {
    mode: "custom" as const,
    protocol: "socks5" as const,
    host: "::1",
    port: 1080,
    username: "a@b",
    password: "p:/?#%",
  };
  await saveNetworkProxy(root, input);
  expect(await readNetworkProxy(root)).toEqual({
    ...input,
    password: undefined,
    hasPassword: true,
  });
  await saveNetworkProxy(root, { ...input, password: undefined });
  expect(
    (JSON.parse(await readFile(join(root, "network-proxy.json"), "utf8")) as { password: string })
      .password,
  ).toBe(input.password);
  if (process.platform !== "win32")
    expect((await stat(join(root, "network-proxy.json"))).mode & 0o777).toBe(0o600);
  await saveNetworkProxy(root, { ...input, password: "" });
  expect((await readNetworkProxy(root)).hasPassword).toBe(false);
});
it("拒绝嵌入凭据的网关与越界端口且不在错误中泄露密码", async () => {
  const root = await mkdtemp(join(tmpdir(), "proxy-"));
  roots.push(root);
  await expect(
    saveNetworkProxy(root, {
      mode: "custom",
      protocol: "http",
      host: "user:secret@host",
      port: 8080,
      username: "",
      password: "secret",
    }),
  ).rejects.toThrow("代理配置无效");
  await expect(
    saveNetworkProxy(root, {
      mode: "custom",
      protocol: "http",
      host: "localhost",
      port: 65536,
      username: "",
    }),
  ).rejects.toThrow();
});
it("直连清除继承变量，自定义代理覆盖大小写环境且保持本地直连", () => {
  const base = {
    HTTPS_PROXY: "old",
    https_proxy: "other",
    ALL_PROXY: "socks5://old",
    NO_PROXY: "*",
  };
  expect(
    proxyEnvironment(
      { mode: "direct", protocol: "http", host: "", port: 8080, username: "" },
      base,
    )["HTTPS_PROXY"],
  ).toBe("");
  const env = proxyEnvironment(
    {
      mode: "custom",
      protocol: "http",
      host: "localhost",
      port: 8080,
      username: "a@b",
      password: "p:/",
    },
    base,
  );
  expect(env["HTTPS_PROXY"]).toBe("http://a%40b:p%3A%2F@localhost:8080/");
  expect(env["NO_PROXY"]).toBe("localhost,127.0.0.1,::1");
});

import { createServer as httpServer } from "node:http";
import { createServer as tcpServer } from "node:net";
import { initializeNetworkProxy } from "./network-proxy.js";

it("真实 HTTP CONNECT 使用指定网关及认证，代理失败不会尝试直连", async () => {
  const root = await mkdtemp(join(tmpdir(), "proxy-"));
  roots.push(root);
  let authorization: string | undefined;
  const server = httpServer();
  server.on("connect", (request, socket) => {
    authorization = request.headers["proxy-authorization"];
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    socket.once("data", () =>
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nproxied"),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  await saveNetworkProxy(root, {
    mode: "custom",
    protocol: "http",
    host: "127.0.0.1",
    port: address.port,
    username: "user",
    password: "secret",
  });
  const runtime = await initializeNetworkProxy(root);
  try {
    expect(
      await (
        await fetch("http://destination.invalid/resource", { signal: AbortSignal.timeout(3000) })
      ).text(),
    ).toBe("proxied");
    expect(authorization).toBe(`Basic ${Buffer.from("user:secret").toString("base64")}`);
  } finally {
    await runtime.close();
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
  }
  const blocked = await initializeNetworkProxy(root);
  try {
    await expect(
      fetch("http://example.com", { signal: AbortSignal.timeout(1000) }),
    ).rejects.toThrow();
  } finally {
    await blocked.close();
  }
});

it("SOCKS5 转接可供 HTTP 客户端与 Claude 环境使用，目标域名交由代理解析", async () => {
  const root = await mkdtemp(join(tmpdir(), "proxy-"));
  roots.push(root);
  let target = "";
  const server = tcpServer((socket) => {
    let stage = 0;
    socket.on("data", (data) => {
      if (stage === 0) {
        stage++;
        socket.write(Buffer.from([5, 0]));
      } else if (stage === 1) {
        expect(data[3]).toBe(3);
        target = data.subarray(5, 5 + (data[4] ?? 0)).toString();
        stage++;
        socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80]));
      } else socket.end("HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nsocks");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  await saveNetworkProxy(root, {
    mode: "custom",
    protocol: "socks5",
    host: "127.0.0.1",
    port: address.port,
    username: "",
  });
  const runtime = await initializeNetworkProxy(root);
  try {
    expect(runtime.env["HTTPS_PROXY"]).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect(
      await (
        await fetch("http://destination.invalid/", { signal: AbortSignal.timeout(3000) })
      ).text(),
    ).toBe("socks");
    expect(target).toBe("destination.invalid");
  } finally {
    await runtime.close();
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
  }
});

it("系统模式使用托管环境快照，不受启动终端的其他代理变量覆盖", async () => {
  const root = await mkdtemp(join(tmpdir(), "proxy-"));
  roots.push(root);
  const server = httpServer();
  server.on("connect", (_request, socket) => {
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    socket.once("data", () =>
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nsystem"),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const runtime = await initializeNetworkProxy(root, {
    HTTP_PROXY: `http://127.0.0.1:${String(address.port)}`,
  });
  try {
    expect(
      await (
        await fetch("http://destination.invalid/", { signal: AbortSignal.timeout(3000) })
      ).text(),
    ).toBe("system");
  } finally {
    await runtime.close();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
});
