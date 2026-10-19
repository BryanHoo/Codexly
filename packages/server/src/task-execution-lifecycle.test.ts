import { expect, it, vi } from "vitest";
import type { ProjectRuntimeContext } from "./routes/context.js";
import { retainTaskExecution, unsubscribeIdleTask } from "./task-execution-lifecycle.js";

it("waits for an in-flight release before allowing submission validation", async () => {
  const gate = Promise.withResolvers<"unsubscribed">();
  const unsubscribeTask = vi.fn(() => gate.promise);
  const runtime = { provider: { unsubscribeTask } } as unknown as ProjectRuntimeContext;
  const releasing = unsubscribeIdleTask(runtime, "task-1");
  let acquired = false;
  const retaining = retainTaskExecution(runtime, "task-1").then((release) => {
    acquired = true;
    return release;
  });
  expect(await unsubscribeIdleTask(runtime, "task-1")).toBe("busy");
  expect(acquired).toBe(false);
  gate.resolve("unsubscribed");
  await releasing;
  const release = await retaining;
  expect(acquired).toBe(true);
  expect(unsubscribeTask).toHaveBeenCalledOnce();
  release();
  expect(await unsubscribeIdleTask(runtime, "task-1")).toBe("unsubscribed");
  expect(unsubscribeTask).toHaveBeenCalledTimes(2);
});
