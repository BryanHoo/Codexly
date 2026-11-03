import { describe, expect, it, vi } from "vitest";
import { createCodexlyServer } from "./app.js";
import {
  closeCallbacks,
  createProvider,
  createServerOptions,
  temporaryProject,
} from "./app-all.test-support.js";

describe("聊天快捷打开", () => {
  it("通过公开聊天路由探测应用并幂等打开聊天工作目录", async () => {
    const open = vi.fn(() => Promise.resolve());
    const capabilities = {
      apps: [{ id: "zed" as const, kind: "editor" as const, name: "Zed" }],
      platform: "darwin" as const,
    };
    const options = createServerOptions(createProvider().provider, {
      projectOpenService: { getCapabilities: () => Promise.resolve(capabilities), open },
    });
    const forTemporary = vi.spyOn(options.provider, "forTemporary");
    const app = await createCodexlyServer(options);
    closeCallbacks.push(() => app.close());
    const response = await app.inject({ method: "GET", url: "/v1/temporary/open-capabilities" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(capabilities);
    // 能力探测只读取宿主应用，不创建聊天运行时或订阅引擎事件。
    expect(forTemporary).not.toHaveBeenCalled();
    const request = {
      method: "POST" as const,
      url: "/v1/temporary/open",
      headers: { "idempotency-key": "chat-open" },
      payload: { appId: "zed" },
    };
    const first = await app.inject(request);
    const repeated = await app.inject(request);
    expect(first.statusCode, first.body).toBe(200);
    expect(repeated.json()).toEqual(first.json());
    expect(open).toHaveBeenCalledExactlyOnceWith(temporaryProject.rootPath, "zed", undefined);
    const overridden = await app.inject({
      ...request,
      headers: { "idempotency-key": "chat-open-root-override" },
      url: "/v1/temporary/open?rootPath=%2Funtrusted",
    });
    expect(overridden.statusCode).toBe(200);
    expect(open).toHaveBeenLastCalledWith(temporaryProject.rootPath, "zed", undefined);
    expect((await app.inject({ ...request, url: "/v1/projects/codexly/open" })).statusCode).toBe(
      400,
    );
    // 普通未知项目不能借聊天入口绕过目录归属校验。
    expect(
      (
        await app.inject({
          ...request,
          url: "/v1/projects/missing/open?rootPath=%2Fworkspace%2Fmissing",
        })
      ).statusCode,
    ).toBe(404);
  });
});
