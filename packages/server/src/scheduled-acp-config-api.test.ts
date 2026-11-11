import type { AcpScheduledConfigView } from "@codexly/protocol";
import { expect, it, vi } from "vitest";
import { createCodexlyServer } from "./app.js";
import { createScheduledTask } from "./scheduled-task-runtime.js";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";
import {
  closeCallbacks,
  createProvider,
  createServerOptions,
  project,
  turnOptions,
} from "./app-all.test-support.js";

async function fixture() {
  const h = createProvider();
  const caps = await h.provider.getCapabilities();
  vi.spyOn(h.provider, "getCapabilities").mockResolvedValue({ ...caps, runtime: "acp" });
  const store = await openRepository(await createWorkspace());
  const saved = await createScheduledTask(
    "saved-plan",
    {
      enabled: false,
      name: "Existing",
      projectId: project.id,
      projectName: project.name,
      prompt: { type: "prompt", text: "scheduled proof", attachments: [], skills: [] },
      messageAttachments: [],
      schedule: { type: "once", atUnixMs: Date.now() + 60000 },
      turnOptions,
    },
    Date.now(),
  );
  await store.replaceScheduledTasks([saved]);
  const preview = vi.fn((_cwd: string, input: { values: Record<string, string | boolean> }) =>
    Promise.resolve({
      values: input.values,
      configOptions: Object.entries(input.values).map(([id, value]) =>
        typeof value === "boolean"
          ? { id, name: id, type: "boolean", currentValue: value }
          : {
              id,
              name: id,
              type: "select",
              currentValue: value,
              options: [{ name: value, value }],
            },
      ),
    }),
  );
  const options = createServerOptions(h.provider, {
    localCatalogStore: store,
    scheduledTaskRepository: store,
    submissionRepository: store,
    acpAgents: { codex: { previewConfig: preview }, claude: { previewConfig: preview } },
  });
  const app = await createCodexlyServer(options);
  closeCallbacks.push(() => app.close());
  h.listModels.mockClear();
  const url = `/v1/scheduled-tasks/${saved.id}/acp-config`;
  const input = {
    projectId: project.id,
    engine: "claude",
    values: { mode: false, model: "raw-model" },
    expectedRevision: 0,
    confirmMigration: true,
  };
  const put = (payload: Record<string, unknown>, key = "save") =>
    app.inject({ method: "PUT", url, headers: { "idempotency-key": key }, payload });
  return { ...h, store, saved, options, app, url, input, put, preview };
}

it("从原计划读取归属，明确确认后保存原始配置，旧计划及设置保持原样", async () => {
  const s = await fixture();
  expect((await s.app.inject(s.url)).json()).toEqual({
    projectId: project.id,
    canEdit: true,
    config: null,
  });
  expect((await s.put({ ...s.input, confirmMigration: false }, "unconfirmed")).statusCode).toBe(
    400,
  );
  expect(s.preview).not.toHaveBeenCalled();
  const saved = await s.put(s.input);
  expect(saved.statusCode, saved.body).toBe(200);
  expect(saved.json()).toEqual({
    projectId: project.id,
    canEdit: true,
    config: { engine: "claude", values: s.input.values, revision: 1 },
  });
  expect(await s.store.listScheduledTasks()).toEqual([s.saved]);
  expect(s.listModels).not.toHaveBeenCalled();
  expect(await s.store.readTaskSettings(project.id, "unused")).toBeUndefined();
});

it("保存已成功但响应丢失时可在重启后确认相同落盘值，不递增修订或再次预览", async () => {
  const s = await fixture();
  expect((await s.put(s.input)).statusCode).toBe(200);
  await s.app.close();
  s.preview.mockRejectedValue(new Error("offline"));
  const restarted = await createCodexlyServer(s.options);
  closeCallbacks.push(() => restarted.close());
  const replay = await restarted.inject({
    method: "PUT",
    url: s.url,
    headers: { "idempotency-key": "after-restart" },
    payload: s.input,
  });
  expect(replay.statusCode, replay.body).toBe(200);
  expect(replay.json<AcpScheduledConfigView>().config?.revision).toBe(1);
  expect(s.preview).toHaveBeenCalledOnce();
});

it("陈旧修订、错误项目及旧配置字段不能覆盖当前选择", async () => {
  const s = await fixture();
  await s.put(s.input);
  expect((await s.put({ ...s.input, values: { mode: true } }, "stale")).statusCode).toBe(409);
  expect(
    (await s.put({ ...s.input, projectId: "another", expectedRevision: 1 }, "foreign")).statusCode,
  ).toBe(409);
  expect((await s.put({ ...s.input, options: turnOptions }, "legacy")).statusCode).toBe(400);
  expect((await s.app.inject(s.url)).json<AcpScheduledConfigView>().config?.values).toEqual(
    s.input.values,
  );
});

it("预览失败保留旧配置，预览期间其他计划读取不等待智能体", async () => {
  const s = await fixture();
  await s.put(s.input);
  let rejectPreview: (reason: Error) => void = () => undefined;
  const pending = new Promise<never>((_, reject) => {
    rejectPreview = reject;
  });
  void pending.catch(() => undefined);
  s.preview.mockImplementationOnce(() => pending);
  const save = s.put(
    { ...s.input, values: { mode: true }, expectedRevision: 1 },
    "preview-failure",
  );
  try {
    await vi.waitFor(() => {
      expect(s.preview).toHaveBeenCalledTimes(2);
    });
    expect((await s.app.inject("/v1/scheduled-tasks")).statusCode).toBe(200);
  } finally {
    rejectPreview(new Error("preview failed"));
  }
  expect((await save).statusCode).toBeGreaterThanOrEqual(400);
  expect((await s.app.inject(s.url)).json<AcpScheduledConfigView>().config?.values).toEqual(
    s.input.values,
  );
});

it("预览后计划已换项目时拒绝保存，未知运行只允许查看配置", async () => {
  const s = await fixture();
  const preview = s.preview.getMockImplementation();
  if (!preview) throw new Error("Preview fixture is required");
  s.preview.mockImplementationOnce(async (cwd, input) => {
    await s.store.replaceScheduledTasks([{ ...s.saved, projectId: "moved", projectName: "Moved" }]);
    return preview(cwd, input);
  });
  expect((await s.put(s.input, "moving")).statusCode).toBe(409);
  expect(
    await s.store.catalog("acp.schedule.read", { source: "web", scheduleId: s.saved.id }),
  ).toBeNull();
  await s.store.replaceScheduledTasks([
    {
      ...s.saved,
      lastRunStatus: "unknown",
      runs: [
        {
          id: "unknown-run",
          status: "unknown",
          startedAtUnixMs: 1,
          finishedAtUnixMs: 2,
          taskId: null,
          error: "unknown",
        },
      ],
    },
  ]);
  expect((await s.app.inject(s.url)).json<AcpScheduledConfigView>().canEdit).toBe(false);
  s.preview.mockClear();
  expect((await s.put(s.input, "unknown")).statusCode).toBe(409);
  expect(s.preview).not.toHaveBeenCalled();
});
