import { fixture } from "./acp-plan-executor.test-support.js";
import { AttachmentStore } from "./attachment-store.js";
import { createScheduledTasks } from "./scheduled-task-assembly.js";
import Database from "better-sqlite3";
import { join } from "node:path";
import { AgentTurnNotSubmittedError } from "@codexly/core";
import { expect, it, vi } from "vitest";
import definition from "../../../tests/fixtures/acp-scheduled-plan-definition.json" with { type: "json" };
import { createServerOptions, project } from "./app-all.test-support.js";
import { createAcpPlanExecutor, acpPlanSubmissionKey } from "./acp-plan-executor.js";
it("新计划只通过 ACP 配置启动，重复恢复不再创建或发送", async () => {
  const s = await fixture();
  const result = await s.run("plan", "run");
  expect(result).toMatchObject({ status: "started" });
  expect(s.configured).toHaveBeenCalledOnce();
  expect(s.configured.mock.calls[0]?.[2]).toEqual(definition.values);
  expect(s.h.startTurn).not.toHaveBeenCalled();
  expect(s.h.listModels).not.toHaveBeenCalled();
  await s.run("plan", "run");
  expect(s.configured).toHaveBeenCalledOnce();
});

it("断线未知阻止重发，恢复不再访问当前项目", async () => {
  const s = await fixture();
  s.configured.mockRejectedValue(new Error("disconnected"));
  expect(await s.run("plan", "run")).toMatchObject({ status: "unknown" });
  s.getProjectContext.mockRejectedValue(new Error("project unavailable"));
  await s.run("plan", "run");
  expect(s.configured).toHaveBeenCalledOnce();
});

it("明确未提交保留任务 ID，资源未就绪不创建任务", async () => {
  const s = await fixture();
  s.configured.mockRejectedValue(new AgentTurnNotSubmittedError("not sent"));
  const failed = await s.run("plan", "run");
  expect(failed?.status).toBe("failed");
  expect(failed?.taskId).toBeTypeOf("string");
  const resources = await fixture({
    prompt: { type: "prompt", text: "with file", attachments: [{ id: "persisted" }], skills: [] },
  });
  const create = vi.spyOn(resources.h.provider, "startTask");
  expect(await resources.run("plan", "run")).toMatchObject({ status: "failed", taskId: null });
  expect(create).not.toHaveBeenCalled();
  expect(resources.configured).not.toHaveBeenCalled();
});
it("结果记录首次写入失败后只补写已确认结果", async () => {
  const s = await fixture();
  const db = new Database(join(s.root, "state.sqlite3"));
  try {
    db.exec(
      "CREATE TRIGGER fail_started BEFORE UPDATE ON task_submissions WHEN json_extract(NEW.record_json,'$.stage')='started' BEGIN SELECT RAISE(ABORT,'save failed'); END;",
    );
    expect(await s.run("plan", "run")).toMatchObject({ status: "started" });
    expect(s.configured).toHaveBeenCalledOnce();
    expect(
      (await s.store.readSubmission(project.id, acpPlanSubmissionKey("plan", "run")))?.stage,
    ).toBe("completed");
  } finally {
    db.close();
  }
});
it("运行结果落盘失败，重建执行器后不依赖当前目录恢复", async () => {
  const s = await fixture();
  const db = new Database(join(s.root, "state.sqlite3"));
  try {
    db.exec(
      "CREATE TRIGGER fail_run BEFORE UPDATE ON acp_plan_runs WHEN NEW.status='started' BEGIN SELECT RAISE(ABORT,'run save failed'); END;",
    );
    await expect(s.run("plan", "run")).rejects.toThrow("run save failed");
    db.exec("DROP TRIGGER fail_run");
    s.getProjectContext.mockRejectedValue(new Error("offline project"));
    const restored = createAcpPlanExecutor({
      catalog: s.store,
      submissions: s.store,
      getProjectContext: s.getProjectContext,
      resolveInput: vi.fn(),
    });
    expect(await restored("plan", "run")).toMatchObject({ status: "started" });
    expect(s.configured).toHaveBeenCalledOnce();
    expect(s.getProjectContext).toHaveBeenCalledOnce();
  } finally {
    db.close();
  }
});
it("未知账本被移除也不能重发", async () => {
  const s = await fixture();
  s.configured.mockRejectedValue(new Error("lost"));
  await s.run("plan", "run");
  const db = new Database(join(s.root, "state.sqlite3"));
  try {
    db.prepare("DELETE FROM task_submissions WHERE submission_key=?").run(
      acpPlanSubmissionKey("plan", "run"),
    );
    expect(await s.run("plan", "run")).toMatchObject({ status: "unknown" });
    expect(s.configured).toHaveBeenCalledOnce();
  } finally {
    db.close();
  }
});
it("同时执行同一领取记录只有一个发送者", async () => {
  const s = await fixture();
  let unlock: () => void = () => {
    throw new Error("not initialized");
  };
  const gate = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  const original = s.configured.getMockImplementation();
  if (!original) throw Error("missing configured port");
  s.configured.mockImplementation(async (...args) => {
    await gate;
    return original(...args);
  });
  const first = s.run("plan", "run");
  await vi.waitFor(() => {
    expect(s.configured).toHaveBeenCalledOnce();
  });
  expect(await s.run("plan", "run")).toMatchObject({ status: "unknown" });
  unlock();
  expect(await first).toMatchObject({ status: "started" });
  expect(s.configured).toHaveBeenCalledOnce();
});

it("两种引擎都只使用 ACP 端口，旧运行时不会回退发送", async () => {
  for (const engine of ["codex", "claude"] as const) {
    const s = await fixture({ engine });
    const create = vi.spyOn(s.h.provider, "startTask");
    expect((await s.run("plan", "run"))?.status).toBe("started");
    expect(create).toHaveBeenCalledWith({ engine });
    expect(s.configured).toHaveBeenCalledOnce();
  }
  const s = await fixture();
  const caps = { ...(await s.h.provider.getCapabilities()) };
  delete caps.runtime;
  vi.spyOn(s.h.provider, "getCapabilities").mockResolvedValue(caps);
  const create = vi.spyOn(s.h.provider, "startTask");
  expect((await s.run("plan", "run"))?.status).toBe("failed");
  expect(create).not.toHaveBeenCalled();
  expect(s.configured).not.toHaveBeenCalled();
});
it("创建任务结果落盘失败保留已知任务引用，恢复不重复创建", async () => {
  const s = await fixture();
  const create = vi.spyOn(s.h.provider, "startTask");
  const db = new Database(join(s.root, "state.sqlite3"));
  try {
    db.exec(
      "CREATE TRIGGER fail_created BEFORE UPDATE ON task_submissions WHEN json_extract(NEW.record_json,'$.stage')='ready' BEGIN SELECT RAISE(ABORT,'create save failed'); END;",
    );
    const result = await s.run("plan", "run");
    expect(result?.status).toBe("unknown");
    expect(result?.taskId).toBeTypeOf("string");
    db.exec("DROP TRIGGER fail_created");
    await s.run("plan", "run");
    expect(create).toHaveBeenCalledOnce();
    expect(s.configured).not.toHaveBeenCalled();
  } finally {
    db.close();
  }
});

it("服务装配提供调用式执行入口，不自动执行私有新计划", async () => {
  const s = await fixture();
  const assembly = await createScheduledTasks(
    createServerOptions(s.h.provider, {
      localCatalogStore: s.store,
      submissionRepository: s.store,
      scheduledTaskRepository: s.store,
    }),
    new AttachmentStore(),
    s.getProjectContext,
    {
      capabilities: await s.h.provider.getCapabilities(),
      listModels: () => Promise.reject(new Error("ACP execution must not read legacy models")),
      resolveProviderTurnInput: s.resolveInput,
    },
  );
  try {
    expect(s.configured).not.toHaveBeenCalled();
    if (!assembly.acpPlanExecutor) throw new Error("Missing ACP plan executor");
    expect((await assembly.acpPlanExecutor("plan", "run"))?.status).toBe("started");
    expect(s.configured).toHaveBeenCalledOnce();
  } finally {
    await assembly.scheduledTaskService.close();
  }
});

it("重启时从已持久化的提交恢复任务引用，不触发发送", async () => {
  const s = await fixture();
  s.configured.mockRejectedValue(new Error("lost"));
  const first = await s.run("plan", "run");
  const db = new Database(join(s.root, "state.sqlite3"));
  try {
    db.exec("UPDATE acp_plan_runs SET task_id=NULL WHERE status='unknown'");
    const restored = await s.run("plan", "run");
    expect(restored?.taskId).toBe(first?.taskId);
    expect(restored?.status).toBe("unknown");
    expect(s.configured).toHaveBeenCalledOnce();
  } finally {
    db.close();
  }
});
