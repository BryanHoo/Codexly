import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createCodexlyServer } from "./app.js";
import { createServerOptions, createProvider } from "./app-all.test-support.js";

it("代理设置沿用访问认证，密码不出现在响应或读取结果", async () => {
  const root = await mkdtemp(join(tmpdir(), "proxy-route-"));
  const app = await createCodexlyServer({
    ...createServerOptions(createProvider().provider),
    networkProxyDirectory: root,
    access: { pairingCode: "123456" },
  });
  try {
    const denied = await app.inject({ method: "GET", url: "/v1/network-proxy" });
    expect(denied.statusCode).toBe(401);
  } finally {
    await app.close();
  }
  const local = await createCodexlyServer({
    ...createServerOptions(createProvider().provider),
    networkProxyDirectory: root,
  });
  try {
    const input = {
      mode: "custom",
      protocol: "http",
      host: "localhost",
      port: 8080,
      username: "user",
      password: "private-value",
    };
    const saved = await local.inject({ method: "PUT", url: "/v1/network-proxy", payload: input });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain("private-value");
    const response = await local.inject({ method: "GET", url: "/v1/network-proxy" });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({ ...input, password: undefined, hasPassword: true });
    const invalid = await local.inject({
      method: "PUT",
      url: "/v1/network-proxy",
      payload: { ...input, port: 0 },
    });
    expect(invalid.statusCode).toBe(400);
  } finally {
    await local.close();
    await rm(root, { recursive: true, force: true });
  }
});
