import { describe, expect, it } from "vitest";
import { createCodexRuntimeProvider } from "./agent-provider.js";
import { FakeRpcClient } from "./provider-connection.test-support.js";

describe("Codex 用户全局默认设置", () => {
  it("通过官方 API 批量写入改动字段并立即刷新读取缓存", async () => {
    const client = new FakeRpcClient();
    client.enqueue("config/read", { config: { model: "old", service_tier: "priority" } });
    client.enqueue("config/read", { config: { model: "new", service_tier: "default" } });
    const runtime = createCodexRuntimeProvider({ client });
    await expect(runtime.readDefaultSettings()).resolves.toMatchObject({
      model: "old",
      fastMode: true,
    });
    await runtime.updateDefaultSettings({
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      model: "new",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
      fastMode: false,
    });
    expect(client.requests[1]).toEqual({
      method: "config/batchWrite",
      params: {
        reloadUserConfig: true,
        edits: [
          { keyPath: "approval_policy", value: "on-request", mergeStrategy: "replace" },
          { keyPath: "approvals_reviewer", value: "auto_review", mergeStrategy: "replace" },
          { keyPath: "model", value: "new", mergeStrategy: "replace" },
          { keyPath: "model_reasoning_effort", value: "high", mergeStrategy: "replace" },
          { keyPath: "sandbox_mode", value: "workspace-write", mergeStrategy: "replace" },
          { keyPath: "service_tier", value: "default", mergeStrategy: "replace" },
        ],
      },
    });
    await expect(runtime.readDefaultSettings()).resolves.toMatchObject({
      model: "new",
      fastMode: false,
    });
    expect(client.requests.at(-1)).toEqual({
      method: "config/read",
      params: { includeLayers: false },
    });
  });

  it("仅写入指定字段，快速模式使用 priority", async () => {
    const client = new FakeRpcClient();
    const runtime = createCodexRuntimeProvider({ client });
    await runtime.updateDefaultSettings({ fastMode: true });
    expect(client.requests).toEqual([
      {
        method: "config/batchWrite",
        params: {
          reloadUserConfig: true,
          edits: [{ keyPath: "service_tier", value: "priority", mergeStrategy: "replace" }],
        },
      },
    ]);
  });
});
