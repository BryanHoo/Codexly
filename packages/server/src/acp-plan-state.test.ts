import type { AcpScheduledPlanDefinition } from "@codexly/protocol/acp-scheduled-plan";
import Database from "better-sqlite3";
import { join } from "node:path";
import { expect, it } from "vitest";
import definitionData from "../../../tests/fixtures/acp-scheduled-plan-definition.json" with { type: "json" };
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";
const definition = definitionData as AcpScheduledPlanDefinition;
it("新计划领取与游标原子提交，未知结果重启后仍阻止重发和编辑", async () => {
  const root = await createWorkspace();
  const store = await openRepository(root);
  const call = (op: string, p: unknown) => store.catalog(op as never, p as never);
  const key = { source: "web", scheduleId: "new" };
  await call("acp.plan.set", {
    ...key,
    definition: { ...definition, enabled: true },
    expectedRevision: 0,
  });
  expect(
    await call("acp.plan.arm", {
      ...key,
      expectedRevision: 1,
      expectedStateRevision: 0,
      nextRunAt: 10,
    }),
  ).toMatchObject({ revision: 1, nextRunAt: 10 });
  const input = {
    ...key,
    expectedRevision: 1,
    expectedStateRevision: 1,
    runId: "run",
    now: 10,
    nextRunAt: 20,
  };
  const results = await Promise.all([
    call("acp.plan.claim", input),
    call("acp.plan.claim", { ...input, runId: "other" }),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(await call("acp.plan.readState", key)).toMatchObject({ revision: 2, nextRunAt: 20 });
  expect(await call("acp.plan.set", { ...key, definition, expectedRevision: 1 })).toBeNull();
  expect(await call("acp.plan.delete", { ...key, expectedRevision: 1 })).toBe(false);
  expect(
    await call("acp.plan.finish", {
      ...key,
      runId: "run",
      expectedStatus: "claimed",
      status: "unknown",
      taskId: null,
      error: "connection lost",
    }),
  ).toMatchObject({ status: "unknown" });
  await store.close();
  const reopened = await openRepository(root);
  const again = (op: string, p: unknown) => reopened.catalog(op as never, p as never);
  expect(
    await again("acp.plan.claim", {
      ...input,
      expectedStateRevision: 2,
      runId: "retry",
      now: 20,
      nextRunAt: 30,
    }),
  ).toBeNull();
  expect(await again("acp.plan.readRun", { ...key, runId: "run" })).toMatchObject({
    status: "unknown",
    definition: { ...definition, enabled: true },
  });
  expect(
    await again("acp.plan.finish", {
      ...key,
      runId: "run",
      expectedStatus: "unknown",
      status: "started",
      taskId: "task",
      error: null,
    }),
  ).toMatchObject({ status: "started", definition: null });
  expect(
    await again("acp.plan.claim", {
      ...input,
      expectedStateRevision: 2,
      runId: "next",
      now: 20,
      nextRunAt: 30,
    }),
  ).toMatchObject({ status: "claimed" });
});

it("执行身份冲突回滚游标，旧定义游标及未到期计划不能领取", async () => {
  const root = await createWorkspace();
  const store = await openRepository(root);
  const call = (op: string, p: unknown) => store.catalog(op as never, p as never);
  for (const scheduleId of ["a", "b"]) {
    await call("acp.plan.set", {
      source: "web",
      scheduleId,
      definition: { ...definition, enabled: true },
      expectedRevision: 0,
    });
    await call("acp.plan.arm", {
      source: "web",
      scheduleId,
      expectedRevision: 1,
      expectedStateRevision: 0,
      nextRunAt: 10,
    });
  }
  const base = {
    source: "web",
    scheduleId: "a",
    expectedRevision: 1,
    expectedStateRevision: 1,
    runId: "same",
    now: 10,
    nextRunAt: 20,
  };
  await call("acp.plan.claim", base);
  await expect(call("acp.plan.claim", { ...base, scheduleId: "b" })).rejects.toThrow();
  expect(await call("acp.plan.readState", { source: "web", scheduleId: "b" })).toMatchObject({
    revision: 1,
    nextRunAt: 10,
  });
  expect(
    await call("acp.plan.claim", { ...base, scheduleId: "b", runId: "early", now: 9 }),
  ).toBeNull();
  await call("acp.plan.finish", {
    source: "web",
    scheduleId: "a",
    runId: "same",
    expectedStatus: "claimed",
    status: "started",
    taskId: "task",
    error: null,
  });
  await call("acp.plan.set", {
    source: "web",
    scheduleId: "a",
    expectedRevision: 1,
    definition: { ...definition, enabled: true, name: "Updated" },
  });
  expect(
    await call("acp.plan.claim", {
      ...base,
      runId: "stale",
      expectedRevision: 2,
      expectedStateRevision: 2,
      now: 20,
      nextRunAt: 30,
    }),
  ).toBeNull();
});

it("独立连接仅能领取一次，完成记录释放快照且只保留最近 20 项", async () => {
  const root = await createWorkspace();
  const a = await openRepository(root),
    b = await openRepository(root);
  const key = { source: "web" as const, scheduleId: "history" };
  await a.catalog("acp.plan.set", {
    ...key,
    definition: { ...definition, engine: "claude", enabled: true },
    expectedRevision: 0,
  });
  await a.catalog("acp.plan.arm", {
    ...key,
    expectedRevision: 1,
    expectedStateRevision: 0,
    nextRunAt: 10,
  });
  const base = { ...key, expectedRevision: 1, expectedStateRevision: 1, now: 10, nextRunAt: 11 };
  const results = await Promise.all(
    [a, b].map((store, i) =>
      store.catalog("acp.plan.claim", { ...base, runId: `race-${String(i)}` }),
    ),
  );
  const first = results.find((v) => v !== null);
  if (!first) throw new Error("A claim must succeed");
  expect(results.filter(Boolean)).toHaveLength(1);
  await a.catalog("acp.plan.finish", {
    ...key,
    runId: first.runId,
    expectedStatus: "claimed",
    status: "failed",
    taskId: null,
    error: "not sent",
  });
  for (let i = 1; i < 25; i++) {
    const runId = `history-${String(i)}`;
    await a.catalog("acp.plan.claim", {
      ...base,
      expectedStateRevision: i + 1,
      now: 10 + i,
      nextRunAt: 11 + i,
      runId,
    });
    await a.catalog("acp.plan.finish", {
      ...key,
      runId,
      expectedStatus: "claimed",
      status: "started",
      taskId: "task",
      error: null,
    });
  }
  expect(await a.catalog("acp.plan.readRun", { ...key, runId: first.runId })).toBeNull();
  expect(await a.catalog("acp.plan.readRun", { ...key, runId: "history-24" })).toMatchObject({
    definition: null,
    status: "started",
  });
});

it("损坏定义不能变成执行快照，领取失败保留游标", async () => {
  const root = await createWorkspace();
  const store = await openRepository(root);
  const key = { source: "web" as const, scheduleId: "corrupt" };
  await store.catalog("acp.plan.set", {
    ...key,
    definition: { ...definition, engine: "claude", enabled: true },
    expectedRevision: 0,
  });
  await store.catalog("acp.plan.arm", {
    ...key,
    expectedRevision: 1,
    expectedStateRevision: 0,
    nextRunAt: 10,
  });
  const db = new Database(join(root, "state.sqlite3"));
  try {
    db.prepare("UPDATE acp_scheduled_plans SET definition_json=?").run(
      JSON.stringify({ ...definition, enabled: true, engine: "invalid" }),
    );
    await expect(
      store.catalog("acp.plan.claim", {
        ...key,
        expectedRevision: 1,
        expectedStateRevision: 1,
        runId: "bad",
        now: 10,
        nextRunAt: 20,
      }),
    ).rejects.toThrow();
    expect(await store.catalog("acp.plan.readState", key)).toMatchObject({
      revision: 1,
      nextRunAt: 10,
    });
  } finally {
    db.close();
  }
});
