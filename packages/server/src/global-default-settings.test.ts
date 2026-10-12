import type { AgentRuntimeDefaultSettings } from "@codexly/core";
import type { AgentGlobalSettingsResponse } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";
import { createCodexlyServer } from "./app.js";
import {
  closeCallbacks,
  createProvider,
  createServerOptions,
  createSettingsRepository,
} from "./app-all.test-support.js";

async function setup() {
  const { provider } = createProvider();
  const local = createSettingsRepository();
  const options = createServerOptions(provider, { settingsRepository: local.repository });
  let defaults: AgentRuntimeDefaultSettings = { approvalPolicy: "never", fastMode: true };
  const updateDefaultSettings = vi.fn((patch: AgentRuntimeDefaultSettings) => {
    defaults = { ...defaults, ...patch };
    return Promise.resolve();
  });
  const app = await createCodexlyServer({
    ...options,
    provider: {
      ...options.provider,
      readDefaultSettings: () => Promise.resolve(defaults),
      updateDefaultSettings,
    },
  });
  closeCallbacks.push(() => app.close());
  const initial = (
    await app.inject({ method: "GET", url: "/v1/settings" })
  ).json<AgentGlobalSettingsResponse>().settings;
  return { app, local, initial, updateDefaultSettings };
}

describe("全局默认设置使用 Codex API", () => {
  it("上下文窗口可保存与清空，未配置时不继承本地旧值", async () => {
    const { app, local, initial, updateDefaultSettings } = await setup();
    expect(initial.modelContextWindow).toBeNull();
    local.readGlobalSettings.mockResolvedValue({ ...initial, modelContextWindow: 123_000 });
    expect(
      (await app.inject({ method: "GET", url: "/v1/settings" })).json<AgentGlobalSettingsResponse>()
        .settings.modelContextWindow,
    ).toBeNull();
    for (const modelContextWindow of [400_000, null]) {
      const response = await app.inject({
        method: "PUT",
        url: "/v1/settings",
        headers: { "idempotency-key": `context-${String(modelContextWindow)}` },
        payload: { ...initial, modelContextWindow },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<AgentGlobalSettingsResponse>().settings.modelContextWindow).toBe(
        modelContextWindow,
      );
      expect(updateDefaultSettings).toHaveBeenLastCalledWith({ modelContextWindow });
    }
  });

  it.each([0, -1, 1.5, "400000", Number.MAX_SAFE_INTEGER + 1])(
    "拒绝非法上下文窗口 %s",
    async (modelContextWindow) => {
      const { app, local, initial, updateDefaultSettings } = await setup();
      const response = await app.inject({
        method: "PUT",
        url: "/v1/settings",
        headers: { "idempotency-key": "invalid-context" },
        payload: { ...initial, modelContextWindow },
      });
      expect(response.statusCode).toBe(400);
      expect(updateDefaultSettings).not.toHaveBeenCalled();
      expect(local.writeGlobalSettings).not.toHaveBeenCalled();
    },
  );
  it("已有本地记录时仍读取最新 Codex 默认值，保留应用偏好", async () => {
    const { app, local, initial } = await setup();
    local.readGlobalSettings.mockResolvedValue({
      ...initial,
      approvalPolicy: "on-request",
      fastMode: false,
      followUpBehavior: "steer",
    });
    const response = await app.inject({ method: "GET", url: "/v1/settings" });
    expect(response.json<AgentGlobalSettingsResponse>().settings).toMatchObject({
      approvalPolicy: "never",
      fastMode: true,
      followUpBehavior: "steer",
    });
  });

  it("只提交变更的智能体字段，应用偏好修改不写 Codex", async () => {
    const { app, initial, updateDefaultSettings } = await setup();
    const changed = { ...initial, approvalPolicy: "on-request", fastMode: false };
    const response = await app.inject({
      method: "PUT",
      url: "/v1/settings",
      headers: { "idempotency-key": "agent" },
      payload: changed,
    });
    expect(response.statusCode).toBe(200);
    expect(updateDefaultSettings).toHaveBeenCalledExactlyOnceWith({
      approvalPolicy: "on-request",
      fastMode: false,
    });
    updateDefaultSettings.mockClear();
    await app.inject({
      method: "PUT",
      url: "/v1/settings",
      headers: { "idempotency-key": "app" },
      payload: { ...changed, followUpBehavior: "steer" },
    });
    expect(updateDefaultSettings).not.toHaveBeenCalled();
  });

  it("Codex 写入失败时不保存本地快照", async () => {
    const { app, local, initial, updateDefaultSettings } = await setup();
    updateDefaultSettings.mockRejectedValueOnce(new Error("Config write failed"));
    const response = await app.inject({
      method: "PUT",
      url: "/v1/settings",
      headers: { "idempotency-key": "failed" },
      payload: { ...initial, fastMode: false },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(500);
    expect(local.writeGlobalSettings).not.toHaveBeenCalled();
    const retry = await app.inject({
      method: "PUT",
      url: "/v1/settings",
      headers: { "idempotency-key": "retry" },
      payload: { ...initial, fastMode: false },
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json<AgentGlobalSettingsResponse>().settings.fastMode).toBe(false);
  });
});
