import { expect, it } from "vitest";
import fixture from "../../../tests/fixtures/acp-scheduled-plan-definition.json" with { type: "json" };
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

it("已知完成意图重启保留且不可改写，终态提交原子回收", async () => {
  const root = await createWorkspace();
  let store = await openRepository(root);
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
  await call("acp.plan.claim", {
    ...key,
    expectedRevision: 1,
    expectedStateRevision: 1,
    now: 10,
    nextRunAt: null,
  });
  await call("acp.plan.finish", {
    ...key,
    expectedStatus: "claimed",
    status: "unknown",
    taskId: null,
    error: "pending",
  });
  const intent = { ...key, projectId: "p", status: "started", taskId: "task", error: null };
  expect(await call("acp.plan.completion.put", { ...intent, projectId: "other" })).toBeNull();
  expect(await call("acp.plan.completion.put", intent)).toEqual(intent);
  expect(await call("acp.plan.completion.put", intent)).toEqual(intent);
  expect(
    await call("acp.plan.completion.put", { ...intent, status: "failed", error: "not sent" }),
  ).toBeNull();
  await store.close();
  store = await openRepository(root);
  expect(await call("acp.plan.completion.read", key)).toEqual(intent);
  await expect(
    call("acp.plan.finish", {
      ...key,
      expectedStatus: "unknown",
      status: "failed",
      taskId: "task",
      error: "wrong",
    }),
  ).rejects.toThrow();
  expect(await call("acp.plan.readRun", key)).toMatchObject({ status: "unknown" });
  expect(await call("acp.plan.finish", { ...intent, expectedStatus: "unknown" })).toMatchObject({
    status: "started",
  });
  expect(await call("acp.plan.completion.read", key)).toBeNull();
  expect(await call("acp.plan.completion.put", intent)).toBeNull();
});
