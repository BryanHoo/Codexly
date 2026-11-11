import { expect, it, vi } from "vitest";
import type { AcpScheduledPlanDefinition } from "@codexly/protocol/acp-scheduled-plan";
import fixture from "../../../tests/fixtures/acp-scheduled-plan-definition.json" with { type: "json" };
import { AcpPlanScheduler } from "./acp-plan-scheduler.js";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

it("显式启动后空闲不忙等，唤醒合并并按新时钟执行到期项", async () => {
  const catalog = await openRepository(await createWorkspace());
  const key = { source: "web" as const, scheduleId: "plan" };
  await catalog.catalog("acp.plan.set", {
    ...key,
    expectedRevision: 0,
    definition: {
      ...(fixture as AcpScheduledPlanDefinition),
      enabled: true,
      schedule: { type: "once", atUnixMs: 600000 },
    },
  });
  await catalog.catalog("acp.plan.arm", {
    ...key,
    expectedRevision: 1,
    expectedStateRevision: 0,
    nextRunAt: 600000,
  });
  let now = 100;
  const queried = vi.spyOn(catalog, "catalog");
  const execute = vi.fn(async (scheduleId: string, runId: string) =>
    catalog.catalog("acp.plan.finish", {
      source: "web",
      scheduleId,
      runId,
      expectedStatus: "claimed",
      status: "failed",
      taskId: null,
      error: "proof",
    }),
  );
  const loop = new AcpPlanScheduler({ catalog, execute, now: () => now });
  try {
    expect(execute).not.toHaveBeenCalled();
    loop.start();
    loop.start();
    await vi.waitFor(() => {
      expect(queried.mock.calls.some(([op]) => op === "acp.plan.nextDue")).toBe(true);
    });
    const count = queried.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(queried.mock.calls.length).toBe(count);
    now = 600000;
    loop.wake();
    loop.wake();
    loop.wake();
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledOnce();
    });
  } finally {
    await loop.close();
  }
  loop.wake();
  expect(execute).toHaveBeenCalledOnce();
});

it("关闭等待当前执行结束，不投递剩余领取且并发唤醒不重入", async () => {
  const catalog = await openRepository(await createWorkspace());
  for (const id of ["a", "b"]) {
    await catalog.catalog("acp.plan.set", {
      source: "web",
      scheduleId: id,
      expectedRevision: 0,
      definition: {
        ...(fixture as AcpScheduledPlanDefinition),
        enabled: true,
        schedule: { type: "once", atUnixMs: 10 },
      },
    });
    await catalog.catalog("acp.plan.arm", {
      source: "web",
      scheduleId: id,
      expectedRevision: 1,
      expectedStateRevision: 0,
      nextRunAt: 10,
    });
  }
  let release: () => void = () => {
    throw Error("Gate is not initialized");
  };
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const execute = vi.fn(async () => {
    await gate;
  });
  const loop = new AcpPlanScheduler({ catalog, execute, now: () => 10 });
  loop.start();
  try {
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledOnce();
    });
    loop.wake();
    loop.wake();
    let ended = false;
    const closing = loop.close().then(() => {
      ended = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ended).toBe(false);
    release();
    await closing;
    expect(execute).toHaveBeenCalledOnce();
    expect(
      (await catalog.catalog("acp.plan.active", { source: "web", limit: 100 })).data,
    ).toHaveLength(2);
  } finally {
    release();
    await loop.close();
  }
});
