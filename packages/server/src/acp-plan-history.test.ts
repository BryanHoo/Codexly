import { expect, it } from "vitest";
import fixture from "../../../tests/fixtures/acp-scheduled-plan-definition.json" with { type: "json" };
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";
it("历史固定来源与项目，仅返回精简记录，并保留同时间的稳定倒序", async () => {
  const store = await openRepository(await createWorkspace());
  const key = { source: "web", scheduleId: "plan" };
  const call = (op: string, p: unknown) => store.catalog(op as never, p as never);
  expect(await call("acp.plan.history", key)).toBeNull();
  await call("acp.plan.set", {
    ...key,
    definition: { ...fixture, enabled: true },
    expectedRevision: 0,
  });
  expect(await call("acp.plan.history", key)).toEqual({ projectId: "p", data: [] });
  await call("acp.plan.arm", {
    ...key,
    expectedRevision: 1,
    expectedStateRevision: 0,
    nextRunAt: 10,
  });
  for (const [i, id] of ["a", "b"].entries()) {
    await call("acp.plan.claim", {
      ...key,
      runId: id,
      expectedRevision: 1,
      expectedStateRevision: 1 + i * 2,
      now: 10,
      nextRunAt: null,
    });
    await call("acp.plan.finish", {
      ...key,
      runId: id,
      expectedStatus: "claimed",
      status: "failed",
      taskId: null,
      error: "not sent",
    });
    if (i === 0)
      await call("acp.plan.arm", {
        ...key,
        expectedRevision: 1,
        expectedStateRevision: 2,
        nextRunAt: 10,
      });
  }
  const history = await call("acp.plan.history", key);
  expect(history).toMatchObject({
    projectId: "p",
    data: [{ runId: "b", status: "failed", claimedAt: 10, definitionRevision: 1 }, { runId: "a" }],
  });
  expect(JSON.stringify(history)).not.toContain('"definition":');
  expect(await call("acp.plan.history", { ...key, source: "desktop" })).toBeNull();
});

it("每计划最多保留二十项，未知结果继续占用且历史不要求项目存在", async () => {
  const store = await openRepository(await createWorkspace());
  const key = { source: "web" as const, scheduleId: "bounded" };
  await store.catalog("acp.plan.set", {
    ...key,
    definition: { ...fixture, enabled: true },
    expectedRevision: 0,
  } as never);
  for (let i = 0; i < 22; i++) {
    await store.catalog("acp.plan.arm", {
      ...key,
      expectedRevision: 1,
      expectedStateRevision: i * 2,
      nextRunAt: 10 + i,
    });
    await store.catalog("acp.plan.claimRef", {
      ...key,
      runId: `r${String(i).padStart(2, "0")}`,
      expectedRevision: 1,
      expectedStateRevision: i * 2 + 1,
      now: 10 + i,
      nextRunAt: null,
    });
    await store.catalog("acp.plan.finish", {
      ...key,
      runId: `r${String(i).padStart(2, "0")}`,
      expectedStatus: "claimed",
      status: i === 21 ? "unknown" : "started",
      taskId: `task/${String(i)}`,
      error: i === 21 ? "connection lost" : null,
    });
  }
  const history = await store.catalog("acp.plan.history", key);
  expect(history?.data).toHaveLength(20);
  expect(history?.data[0]).toEqual({
    runId: "r21",
    claimedAt: 31,
    status: "unknown",
    taskId: "task/21",
    definitionRevision: 1,
    error: "connection lost",
  });
  expect(history?.data.at(-1)?.runId).toBe("r02");
  expect(await store.catalog("project.read", { id: fixture.projectId })).toBeNull();
  expect((await store.catalog("acp.plan.view", key))?.canEdit).toBe(false);
  expect(await store.catalog("acp.plan.summary", { ...key, runId: "r21" })).toEqual(
    history?.data[0],
  );
  expect(
    await store.catalog("acp.plan.summary", { ...key, source: "desktop", runId: "r21" }),
  ).toBeNull();
  expect(JSON.stringify(history)).not.toContain('"definition":');
});
