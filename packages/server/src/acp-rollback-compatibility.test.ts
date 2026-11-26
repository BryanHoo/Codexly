import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import { expect, it } from "vitest";
import { AgentGlobalSettingsSchema, AgentTaskSettingsSchema } from "@codexly/protocol";
import { applicationPreferencesFromLegacy } from "@codexly/core";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

const contract = JSON.parse(
  await readFile(
    new URL("../../../tests/fixtures/acp-rollback-v0.53.0.json", import.meta.url),
    "utf8",
  ),
) as {
  source: { tag: string; commit: string };
  globalSettings: Record<string, unknown>;
  taskSettings: Record<string, unknown>;
};

it("旧配置契约固定为实际发布版本，ACP 不得把新字段或枚举加入旧记录", () => {
  expect(contract.source).toEqual({
    tag: "v0.53.0",
    commit: "4f6596e2691c30ffedde8c7a913ad073c23b259b",
  });
  // JSON 化只去掉 TypeBox 的运行时符号；冻结数据直接提取自旧 tag，不能改用当前 Schema。
  expect(JSON.parse(JSON.stringify(AgentGlobalSettingsSchema))).toEqual(contract.globalSettings);
  expect(JSON.parse(JSON.stringify(AgentTaskSettingsSchema))).toEqual(contract.taskSettings);
});

it("新版设置仓储往返后，v0.53.0 的严格读取契约仍接受原设置", async () => {
  const repository = await openRepository(await createWorkspace());
  const task = {
    approvalPolicy: "on-request" as const,
    approvalsReviewer: "user" as const,
    model: "legacy-model",
    reasoningEffort: "high",
    sandboxMode: "workspace-write" as const,
  };
  const global = {
    ...task,
    defaultModel: "legacy-generation",
    commitMessagePrompt: "旧提交规则",
    modelContextWindow: null,
    defaultOpenAppId: null,
    fastMode: false,
    followUpBehavior: "queue" as const,
    pet: { enabled: false, selectedPetId: "codex" },
  };
  await repository.writeGlobalSettings(global);
  await repository.writeTaskSettings("temporary", "legacy-task", task);
  await repository.catalog("app.preferences.patch", {
    baseline: applicationPreferencesFromLegacy(global),
    changes: { defaultAgent: "claude", defaultModel: "raw/acp/model".repeat(1000) },
  });
  await repository.catalog("app.preferences.patch", {
    baseline: applicationPreferencesFromLegacy(global),
    changes: { defaultAgent: "codex", defaultModel: null },
  });
  // 新版真实写入原始 ACP 计划配置后，再让冻结的旧读取器校验原设置。
  await repository.catalog("acp.schedule.set", {
    source: "web",
    scheduleId: "legacy-plan",
    engine: "claude",
    values: { "agent-defined-mode": true, model: "native-model" },
    expectedRevision: 0,
  });
  const old = Fastify({
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } },
  });
  old.post("/global", { schema: { body: contract.globalSettings } }, (request, reply) => {
    reply.send(request.body);
  });
  old.post("/task", { schema: { body: contract.taskSettings } }, (request, reply) => {
    reply.send(request.body);
  });
  try {
    for (const [url, payload] of [
      ["/global", await repository.readGlobalSettings()],
      ["/task", await repository.readTaskSettings("temporary", "legacy-task")],
    ] as const) {
      if (payload === undefined) throw new Error("旧配置记录不应丢失");
      const response = await old.inject({ method: "POST", url, payload });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual(payload);
    }
    // 负对照确认旧读取端会拒绝 ACP 原始控件值，不能因校验器删字段而出现假兼容。
    expect(
      (
        await old.inject({
          method: "POST",
          url: "/global",
          payload: {
            ...global,
            acpConfigOptions: [{ id: "mode", type: "boolean", currentValue: false }],
          },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await old.inject({
          method: "POST",
          url: "/task",
          payload: { ...task, sandboxMode: "agent-defined-mode" },
        })
      ).statusCode,
    ).toBe(400);
  } finally {
    await old.close();
  }
});
