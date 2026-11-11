import { expect, it } from "vitest";
import fixture from "../../../tests/fixtures/acp-scheduled-plan-definition.json" with { type: "json" };
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";
import Database from "better-sqlite3";
import { join } from "node:path";
import type { AcpScheduledPlanDefinition } from "@codexly/protocol/acp-scheduled-plan";

it("未解决运行按来源有界分页，下次时间只考虑可领取的未来游标", async () => {
  const store = await openRepository(await createWorkspace());
  const call = (op: string, p: unknown) => store.catalog(op as never, p as never);
  for (const [source, id, time] of [
    ["web", "a", 10],
    ["web", "b", 20],
    ["web", "c", 30],
    ["desktop", "a", 40],
  ] as const) {
    const key = { source, scheduleId: id };
    await call("acp.plan.set", {
      ...key,
      expectedRevision: 0,
      definition: { ...fixture, enabled: true },
    });
    await call("acp.plan.arm", {
      ...key,
      expectedRevision: 1,
      expectedStateRevision: 0,
      nextRunAt: time,
    });
  }
  for (const id of ["a", "b"]) {
    await call("acp.plan.claim", {
      source: "web",
      scheduleId: id,
      runId: `run-${id}`,
      expectedRevision: 1,
      expectedStateRevision: 1,
      now: 20,
      nextRunAt: 100,
    });
  }
  expect(await call("acp.plan.active", { source: "web", limit: 1 })).toEqual({
    data: [{ scheduleId: "a", runId: "run-a" }],
    nextCursor: "a",
  });
  expect(await call("acp.plan.active", { source: "web", after: "a", limit: 1 })).toEqual({
    data: [{ scheduleId: "b", runId: "run-b" }],
    nextCursor: null,
  });
  expect(await call("acp.plan.active", { source: "desktop", limit: 1 })).toEqual({
    data: [],
    nextCursor: null,
  });
  expect(await call("acp.plan.nextDue", { source: "web", after: 0 })).toBe(30);
  expect(await call("acp.plan.nextDue", { source: "web", after: 30 })).toBeNull();
  for (const id of ["disabled", "stale", "unarmed"]) {
    await call("acp.plan.set", {
      source: "web",
      scheduleId: id,
      expectedRevision: 0,
      definition: { ...fixture, enabled: id !== "disabled" },
    });
    if (id !== "unarmed")
      await call("acp.plan.arm", {
        source: "web",
        scheduleId: id,
        expectedRevision: 1,
        expectedStateRevision: 0,
        nextRunAt: 80,
      });
    if (id === "stale")
      await call("acp.plan.set", {
        source: "web",
        scheduleId: id,
        expectedRevision: 1,
        definition: { ...fixture, enabled: true, name: "new revision" },
      });
  }
  expect(await call("acp.plan.nextDue", { source: "web", after: 30 })).toBeNull();
  expect(await call("acp.plan.nextDue", { source: "desktop", after: 0 })).toBe(40);
  await call("acp.plan.finish", {
    source: "web",
    scheduleId: "a",
    runId: "run-a",
    expectedStatus: "claimed",
    status: "failed",
    taskId: null,
    error: "not sent",
  });
  expect(await call("acp.plan.active", { source: "web", limit: 100 })).toEqual({
    data: [{ scheduleId: "b", runId: "run-b" }],
    nextCursor: null,
  });
  await expect(call("acp.plan.active", { source: "web", limit: 101 })).rejects.toThrow();
});

it("精简领取遇到损坏定义仍回滚游标及运行插入", async () => {
  const root = await createWorkspace();
  const store = await openRepository(root);
  const key = { source: "web" as const, scheduleId: "plan", runId: "run" };
  await store.catalog("acp.plan.set", {
    ...key,
    expectedRevision: 0,
    definition: { ...(fixture as AcpScheduledPlanDefinition), enabled: true },
  });
  await store.catalog("acp.plan.arm", {
    ...key,
    expectedRevision: 1,
    expectedStateRevision: 0,
    nextRunAt: 10,
  });
  const db = new Database(join(root, "state.sqlite3"));
  try {
    db.exec(
      "UPDATE acp_scheduled_plans SET definition_json=json_set(definition_json,'$.prompt.text',42)",
    );
    await expect(
      store.catalog("acp.plan.claimRef", {
        ...key,
        expectedRevision: 1,
        expectedStateRevision: 1,
        now: 10,
        nextRunAt: null,
      }),
    ).rejects.toThrow();
    expect(await store.catalog("acp.plan.readState", key)).toMatchObject({
      revision: 1,
      nextRunAt: 10,
    });
    expect(await store.catalog("acp.plan.readRun", key)).toBeNull();
  } finally {
    db.close();
  }
});

it("精简领取仍原子保存快照，只返回执行身份", async () => {
  const store = await openRepository(await createWorkspace());
  const call = (op: string, p: unknown) => store.catalog(op as never, p as never);
  const key = { source: "web", scheduleId: "plan", runId: "run" };
  await call("acp.plan.set", {
    ...key,
    expectedRevision: 0,
    definition: { ...fixture, enabled: true },
  });
  await call("acp.plan.arm", {
    ...key,
    expectedRevision: 1,
    expectedStateRevision: 0,
    nextRunAt: 10,
  });
  expect(
    await call("acp.plan.claimRef", {
      ...key,
      expectedRevision: 1,
      expectedStateRevision: 1,
      now: 10,
      nextRunAt: null,
    }),
  ).toEqual({ scheduleId: "plan", runId: "run" });
  expect(await call("acp.plan.readRun", key)).toMatchObject({
    status: "claimed",
    definition: { prompt: fixture.prompt },
  });
});
