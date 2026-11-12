import { expect, it, vi } from "vitest";
import { AcpPlanChanges } from "./acp-plan-events.js";
import { fixture } from "./acp-plan-executor.test-support.js";
it("执行观察只通知精简状态变化，未知恢复不重复通知，监听故障不能影响执行", async () => {
  const h = await fixture();
  const changes = new AcpPlanChanges();
  const listener = vi.fn();
  const stop = changes.subscribe(listener);
  const run = changes.observe(h.store, h.run);
  const started = await run("plan", "run");
  expect(started?.status).toBe("started");
  expect(listener).toHaveBeenCalledTimes(2);
  await run("plan", "run");
  expect(listener).toHaveBeenCalledTimes(2);
  stop();
  const read = vi.spyOn(h.store, "catalog");
  read.mockClear();
  await run("plan", "run");
  expect(read.mock.calls.some(([op]) => op === "acp.plan.summary")).toBe(false);
  changes.subscribe(() => {
    throw Error("observer");
  });
  expect(() => {
    changes.publish();
  }).not.toThrow();
});
it("未知状态没有变化时不触发通知，执行异常仍保留原错误", async () => {
  const h = await fixture();
  await h.store.catalog("acp.plan.finish", {
    ...h.key,
    runId: "run",
    expectedStatus: "claimed",
    status: "unknown",
    taskId: null,
    error: "pending",
  });
  const changes = new AcpPlanChanges();
  const listener = vi.fn();
  changes.subscribe(listener);
  await changes.observe(h.store, h.run)("plan", "run");
  expect(listener).not.toHaveBeenCalled();
  const error = Error("execution");
  await expect(changes.observe(h.store, () => Promise.reject(error))("plan", "run")).rejects.toBe(
    error,
  );
});
