import { afterEach, expect, it, vi } from "vitest";

import { ActiveTaskSnapshotRecoveryController } from "./task-snapshot-recovery.js";

afterEach(() => vi.useRealTimers());

it("drops an in-flight snapshot when the same task is queued again after cancellation", async () => {
  vi.useFakeTimers();
  const first = Promise.withResolvers<string>();
  const recoverTask = vi.fn<(taskId: string) => Promise<string>>();
  recoverTask.mockReturnValueOnce(first.promise).mockResolvedValueOnce("current");
  const publish = vi.fn();
  const recovery = new ActiveTaskSnapshotRecoveryController(recoverTask, publish);
  try {
    recovery.requestRecovery(["task"]);
    recovery.cancelRecovery();
    recovery.requestRecovery(["task"]);
    first.resolve("obsolete");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(publish.mock.calls).toEqual([["task", "current"]]);
  } finally {
    recovery.dispose();
  }
});
