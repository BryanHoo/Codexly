import { afterEach, expect, it, vi } from "vitest";
import type { AgentProvider } from "@codexly/core";
import type { AgentEngine } from "@codexly/protocol";
import { createCodexlyServer } from "./app.js";
import { AttachmentStore } from "./attachment-store.js";
import { Readable } from "node:stream";
import { ScheduledTaskAttachmentManager } from "./scheduled-task-attachments.js";
import { createMemorySubmissionRepository } from "./task-submission-service.js";
import { createMemoryScheduledTaskRepository } from "./scheduled-task-service.js";
import { createScheduledTask } from "./scheduled-task-runtime.js";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";
import {
  closeCallbacks,
  createProvider,
  createServerOptions,
  project,
  turnOptions,
} from "./app-all.test-support.js";

afterEach(() => vi.restoreAllMocks());

async function setup(
  engine: AgentEngine = "claude",
  configured = true,
  runtime = true,
  persistence: "memory" | "sqlite" = "memory",
) {
  const harness = createProvider();
  const capabilities = await harness.provider.getCapabilities();
  vi.spyOn(harness.provider, "getCapabilities").mockResolvedValue({
    ...capabilities,
    ...(runtime ? { runtime: "acp" as const } : {}),
  });
  const startTurn = harness.startTurn.getMockImplementation();
  if (!startTurn) throw new Error("Turn fixture is required");
  const configuredTurn = vi.fn<NonNullable<AgentProvider["startConfiguredTurn"]>>((taskId, input) =>
    startTurn(taskId, input, turnOptions),
  );
  harness.provider.startConfiguredTurn = configuredTurn;
  const catalog = await openRepository(await createWorkspace());
  const schedules = persistence === "sqlite" ? catalog : createMemoryScheduledTaskRepository();
  const submissions = persistence === "sqlite" ? catalog : createMemorySubmissionRepository(100);
  const saved = await createScheduledTask(
    "existing-plan",
    {
      enabled: false,
      messageAttachments: [],
      name: "Saved plan",
      projectId: project.id,
      projectName: project.name,
      prompt: { type: "prompt", text: "scheduled body", attachments: [], skills: [] },
      schedule: { type: "once", atUnixMs: Date.now() + 60_000 },
      turnOptions,
    },
    Date.now(),
  );
  await schedules.replaceScheduledTasks([saved]);
  const values = { raw_model: "adapter-model", raw_permission: false };
  if (configured)
    await catalog.catalog("acp.schedule.set", {
      source: "web",
      scheduleId: saved.id,
      engine,
      values,
      expectedRevision: 0,
    });
  const readConfig = vi.fn(catalog.catalog.bind(catalog));
  const options = createServerOptions(harness.provider, {
    localCatalogStore: { catalog: readConfig },
    scheduledTaskRepository: schedules,
    submissionRepository: submissions,
    ...(persistence === "sqlite" ? { scheduledTaskAttachmentRepository: catalog } : {}),
  });
  const app = await createCodexlyServer(options);
  closeCallbacks.push(() => app.close());
  harness.listModels.mockClear();
  const writeSettings = vi.spyOn(options.settingsRepository, "writeTaskSettings");
  const run = () =>
    app.inject({
      method: "POST",
      url: `/v1/scheduled-tasks/${saved.id}/run`,
      headers: { "idempotency-key": "run" },
    });
  const status = async () => {
    const task = (await schedules.listScheduledTasks())[0];
    if (!task) throw new Error("Scheduled task fixture is required");
    return task;
  };
  return {
    app,
    harness,
    configuredTurn,
    catalog,
    readConfig,
    schedules,
    submissions,
    saved,
    options,
    values,
    writeSettings,
    run,
    status,
  };
}

it.each(["codex", "claude"] as const)(
  "%s 计划只提交保存的原始 ACP 配置，不消费旧模型与权限设置",
  async (engine) => {
    const s = await setup(engine);
    expect((await s.run()).statusCode).toBe(200);
    await vi.waitFor(async () => {
      expect((await s.status()).lastRunStatus).toBe("started");
    });
    expect(s.harness.startTask).toHaveBeenCalledWith({ engine });
    expect(s.configuredTurn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ text: "scheduled body" }),
      s.values,
    );
    expect(s.harness.startTurn).not.toHaveBeenCalled();
    expect(s.harness.listModels).not.toHaveBeenCalled();
    expect(s.writeSettings).not.toHaveBeenCalled();
    expect((await s.status()).turnOptions).toEqual(s.saved.turnOptions);
  },
);

it("缺少 Web 配置时在创建任务前失败，同名桌面配置不接管 Web 计划", async () => {
  const s = await setup("claude", false);
  await s.catalog.catalog("acp.schedule.set", {
    source: "desktop",
    scheduleId: s.saved.id,
    engine: "claude",
    values: s.values,
    expectedRevision: 0,
  });
  await s.run();
  await vi.waitFor(async () => {
    expect((await s.status()).lastRunStatus).toBe("failed");
  });
  expect(s.harness.startTask).not.toHaveBeenCalled();
  expect(s.harness.listModels).not.toHaveBeenCalled();
  expect(s.writeSettings).not.toHaveBeenCalled();
});

it("ACP 端口不可用时不创建任务，也不回退旧 startTurn", async () => {
  const s = await setup();
  delete s.harness.provider.startConfiguredTurn;
  await s.run();
  await vi.waitFor(async () => {
    expect((await s.status()).lastRunStatus).toBe("failed");
  });
  expect(s.harness.startTask).not.toHaveBeenCalled();
  expect(s.harness.startTurn).not.toHaveBeenCalled();
});

it("ACP 配置读取失败不启动任务，也不使用旧设置继续执行", async () => {
  const s = await setup();
  s.readConfig.mockRejectedValue(new Error("configuration unavailable"));
  await s.run();
  await vi.waitFor(async () => {
    expect((await s.status()).lastRunStatus).toBe("failed");
  });
  expect(s.harness.startTask).not.toHaveBeenCalled();
  expect(s.harness.listModels).not.toHaveBeenCalled();
  expect(s.writeSettings).not.toHaveBeenCalled();
});

it("ACP 发送结果未知时保留任务身份并禁止同一计划自动或手工重发", async () => {
  const s = await setup();
  s.configuredTurn.mockRejectedValue(new Error("connection lost"));
  await s.run();
  await vi.waitFor(async () => {
    expect((await s.status()).lastRunStatus).toBe("unknown");
  });
  const saved = await s.status();
  expect(saved.runs[0]?.taskId).toEqual(expect.any(String));
  expect(saved.enabled).toBe(false);
  const response = await s.app.inject({
    method: "POST",
    url: `/v1/scheduled-tasks/${s.saved.id}/run`,
    headers: { "idempotency-key": "retry" },
  });
  expect(response.statusCode).toBe(409);
  expect(s.configuredTurn).toHaveBeenCalledOnce();
});

it("ACP 启动成功但账本写入暂时失败时只补写结果，不因配置变化重复启动", async () => {
  const s = await setup();
  if (!s.submissions.writeAcpSubmission) throw new Error("ACP submission repository is required");
  const write = s.submissions.writeAcpSubmission.bind(s.submissions);
  let failed = false;
  vi.spyOn(s.submissions, "writeAcpSubmission").mockImplementation(
    (projectId, key, record, intent) => {
      if (!failed && record.stage === "started") {
        failed = true;
        return Promise.reject(new Error("temporary journal failure"));
      }
      return write(projectId, key, record, intent);
    },
  );
  await s.run();
  await vi.waitFor(async () => {
    expect((await s.status()).lastRunStatus).toBe("cleanup_pending");
  });
  await s.catalog.catalog("acp.schedule.set", {
    source: "web",
    scheduleId: s.saved.id,
    engine: "codex",
    values: { changed: true },
    expectedRevision: 1,
  });
  await vi.waitFor(
    async () => {
      expect((await s.status()).lastRunStatus).toBe("started");
    },
    {
      timeout: 4000,
    },
  );
  expect(s.harness.startTask).toHaveBeenCalledOnce();
  expect(s.configuredTurn).toHaveBeenCalledOnce();
  expect(s.configuredTurn).toHaveBeenCalledWith(expect.any(String), expect.any(Object), s.values);
  expect(s.readConfig).toHaveBeenCalledOnce();
});

it("重启收尾优先重放已知结果，配置已删除和项目不可用也不重新发起 ACP", async () => {
  const s = await setup();
  const consume = vi
    .spyOn(AttachmentStore.prototype, "consume")
    .mockRejectedValue(new Error("cleanup unavailable"));
  await s.run();
  await vi.waitFor(async () => {
    expect((await s.status()).lastRunStatus).toBe("cleanup_pending");
  });
  const before = await s.status();
  await s.app.close();
  consume.mockRestore();
  await s.catalog.catalog("acp.schedule.delete", {
    source: "web",
    scheduleId: s.saved.id,
    expectedRevision: 1,
  });
  vi.spyOn(s.options.projectRepository, "read").mockRejectedValue(new Error("project unavailable"));
  s.readConfig.mockClear();
  s.configuredTurn.mockRejectedValue(new Error("must not resend"));
  const restarted = await createCodexlyServer(s.options);
  closeCallbacks.push(() => restarted.close());
  await vi.waitFor(
    async () => {
      expect((await s.status()).lastRunStatus).toBe("started");
    },
    {
      timeout: 4000,
    },
  );
  expect((await s.status()).runs[0]?.taskId).toBe(before.runs[0]?.taskId);
  expect(s.harness.startTask).toHaveBeenCalledOnce();
  expect(s.configuredTurn).toHaveBeenCalledOnce();
  expect(s.readConfig).not.toHaveBeenCalled();
});

it("旧运行时保持原计划执行，不读取 ACP 私有配置", async () => {
  const s = await setup("claude", true, false);
  s.readConfig.mockClear();
  await s.run();
  await vi.waitFor(async () => {
    expect((await s.status()).lastRunStatus).toBe("started");
  });
  expect(s.configuredTurn).not.toHaveBeenCalled();
  expect(s.harness.startTurn).toHaveBeenCalledOnce();
  expect(s.readConfig).not.toHaveBeenCalled();
});

it("真实 SQLite 计划、配置和附件在服务重启后交给 ACP，上传缓存清理不影响持久附件", async () => {
  const s = await setup("claude", true, true, "sqlite");
  const uploads = new AttachmentStore();
  try {
    const upload = await uploads.add(project.id, {
      content: Readable.from(["saved attachment proof"]),
      kind: "text",
      mediaType: "text/plain",
      name: "saved.txt",
    });
    const task = {
      ...s.saved,
      messageAttachments: [upload.attachment],
      prompt: { ...s.saved.prompt, attachments: [{ id: upload.attachment.id }] },
    };
    const resources = await new ScheduledTaskAttachmentManager(uploads, s.catalog).prepare(task);
    await s.catalog.replaceScheduledTasks([task], resources);
  } finally {
    await uploads.dispose();
  }
  await s.app.close();
  const restarted = await createCodexlyServer(s.options);
  closeCallbacks.push(() => restarted.close());
  expect(
    (
      await restarted.inject({
        method: "POST",
        url: `/v1/scheduled-tasks/${s.saved.id}/run`,
        headers: { "idempotency-key": "run-after-restart" },
      })
    ).statusCode,
  ).toBe(200);
  await vi.waitFor(async () => {
    expect((await s.status()).lastRunStatus).toBe("started");
  });
  expect(s.configuredTurn).toHaveBeenCalledExactlyOnceWith(
    expect.any(String),
    expect.objectContaining({
      textAttachments: [{ name: "saved.txt", text: "saved attachment proof" }],
    }),
    s.values,
  );
  expect(s.harness.startTurn).not.toHaveBeenCalled();
  expect(s.writeSettings).not.toHaveBeenCalled();
  const run = (await s.status()).runs[0];
  if (!run) throw new Error("Scheduled run is required");
  expect((await s.catalog.readSubmission(project.id, `scheduled:${run.id}`))?.stage).toBe(
    "completed",
  );
  expect((await s.status()).turnOptions).toEqual(s.saved.turnOptions);
});

it("旧运行时的已知结果可在切换 ACP 后收尾，无需转换原计划或重发旧请求", async () => {
  const s = await setup("codex", false, false);
  const consume = vi
    .spyOn(AttachmentStore.prototype, "consume")
    .mockRejectedValue(new Error("cleanup unavailable"));
  await s.run();
  await vi.waitFor(async () => {
    expect((await s.status()).lastRunStatus).toBe("cleanup_pending");
  });
  await s.app.close();
  consume.mockRestore();
  const capabilities = await s.harness.provider.getCapabilities();
  vi.spyOn(s.harness.provider, "getCapabilities").mockResolvedValue({
    ...capabilities,
    runtime: "acp",
  });
  s.readConfig.mockClear();
  const restarted = await createCodexlyServer(s.options);
  closeCallbacks.push(() => restarted.close());
  await vi.waitFor(
    async () => {
      expect((await s.status()).lastRunStatus).toBe("started");
    },
    {
      timeout: 4000,
    },
  );
  expect(s.harness.startTask).toHaveBeenCalledOnce();
  expect(s.harness.startTurn).toHaveBeenCalledOnce();
  expect(s.configuredTurn).not.toHaveBeenCalled();
  expect(s.readConfig).not.toHaveBeenCalled();
  expect((await s.status()).turnOptions).toEqual(s.saved.turnOptions);
});
