import { expect, test } from "vitest";
import {
  FakeRpcClient,
  createCodexAgentProvider,
  nativeThread,
  project,
} from "./agent-provider.test-support.js";

test.each(["applied", "targetUnavailable"] as const)(
  "updates only the exact turn reviewer (%s)",
  async (status) => {
    const rpc = new FakeRpcClient([{ thread: nativeThread() }, { status }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.startTask();
    await expect(
      provider.updateTurnApprovalsReviewer("task-1", "turn-1", "auto_review"),
    ).resolves.toBe(status);
    expect(rpc.calls.at(-1)).toEqual({
      method: "turn/settings/update",
      params: {
        threadId: "task-1",
        turnId: "turn-1",
        approvalsReviewer: "auto_review",
      },
    });
  },
);

test("rejects foreign tasks without publishing settings", async () => {
  const rpc = new FakeRpcClient([]);
  const provider = createCodexAgentProvider({ client: rpc, project });
  await expect(provider.updateTurnApprovalsReviewer("foreign", "turn-1", "user")).rejects.toThrow();
  expect(rpc.calls).toEqual([]);
});
