import { expect, it } from "vitest";
import type { AcpPlanScan } from "./acp-plan-scheduler.js";
import { scanAcpPlanBatch } from "./acp-plan-scheduler.js";
import type { AcpScheduledPlanDefinition } from "@codexly/protocol/acp-scheduled-plan";
import fixture from "../../../tests/fixtures/acp-scheduled-plan-definition.json" with { type: "json" };
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

it("先恢复未解决运行，再分页领取到期项，错误不阻断后续计划", async () => {
  const catalog = await openRepository(await createWorkspace());
  for (const id of ["a-active", "b-claimed", "c-bad", "d-due", "e-future"]) {
    const key = { source: "web" as const, scheduleId: id };
    const schedule =
      id === "c-bad"
        ? { type: "rrule" as const, rrule: "invalid", timezone: "UTC", startAtUnixMs: 1 }
        : { type: "once" as const, atUnixMs: id === "e-future" ? 200 : 10 };
    await catalog.catalog("acp.plan.set", {
      ...key,
      expectedRevision: 0,
      definition: { ...(fixture as AcpScheduledPlanDefinition), enabled: true, schedule },
    });
    await catalog.catalog("acp.plan.arm", {
      ...key,
      expectedRevision: 1,
      expectedStateRevision: 0,
      nextRunAt: id === "e-future" ? 200 : 10,
    });
    if (id === "a-active" || id === "b-claimed")
      await catalog.catalog("acp.plan.claim", {
        ...key,
        runId: id,
        expectedRevision: 1,
        expectedStateRevision: 1,
        now: 10,
        nextRunAt: null,
      });
  }
  await catalog.catalog("acp.plan.finish", {
    source: "web",
    scheduleId: "a-active",
    runId: "a-active",
    expectedStatus: "claimed",
    status: "unknown",
    taskId: null,
    error: "pending",
  });
  const calls: string[] = [];
  const execute = async (scheduleId: string, runId: string) => {
    calls.push(scheduleId);
    if (scheduleId === "a-active") throw Error("still unknown");
    await catalog.catalog("acp.plan.finish", {
      source: "web",
      scheduleId,
      runId,
      expectedStatus: "claimed",
      status: "failed",
      taskId: null,
      error: "proof",
    });
  };
  let cursor: AcpPlanScan | null = { phase: "recovery" };
  const errors: string[] = [];
  for (let i = 0; cursor && i < 10; i++) {
    const result = await scanAcpPlanBatch({ catalog, execute }, 10, cursor, 1);
    errors.push(...result.errors.map((e) => e.scheduleId));
    cursor = result.next;
  }
  expect(cursor).toBeNull();
  expect(calls).toEqual(["a-active", "b-claimed", "d-due"]);
  expect(errors).toEqual(["a-active", "c-bad"]);
  expect(await catalog.catalog("acp.plan.nextDue", { source: "web", after: 10 })).toBe(200);
  expect(await catalog.catalog("acp.plan.active", { source: "web", limit: 100 })).toEqual({
    data: [{ scheduleId: "a-active", runId: "a-active" }],
    nextCursor: null,
  });
});
