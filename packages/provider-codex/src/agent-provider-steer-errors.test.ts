import { describe, expect, it } from "vitest";
import { RpcConnectionClosedError, RpcResponseError } from "./jsonl-rpc-errors.js";
import {
  createCodexAgentProvider,
  FakeRpcClient,
  nativeThread,
  project,
} from "./agent-provider.test-support.js";

const input = { files: [], images: [], skills: [], text: "追加消息", textAttachments: [] };

describe("Codex steer rejection classification", () => {
  it.each(["expected active turn id `turn-1` but found `turn-2`", "no active turn to steer"])(
    "marks a confirmed undelivered steer as recoverable: %s",
    async (message) => {
      const error = new RpcResponseError({ code: -32600, data: undefined, message });
      const rpc = new FakeRpcClient([{ thread: nativeThread() }, error]);
      const provider = createCodexAgentProvider({ client: rpc, project });
      await provider.startTask();
      await expect(provider.steerTurn("task-1", "turn-1", input)).rejects.toMatchObject({
        name: "AgentTurnNotSubmittedError",
        message,
        cause: error,
      });
      expect(rpc.calls.map((call) => call.method)).toEqual(["thread/start", "turn/steer"]);
    },
  );

  it.each([
    new Error("no active turn to steer"),
    new RpcConnectionClosedError(),
    new RpcResponseError({ code: -32000, data: undefined, message: "no active turn to steer" }),
    new RpcResponseError({ code: -32600, data: undefined, message: "failed to steer turn" }),
    new RpcResponseError({
      code: -32600,
      data: undefined,
      message: "expected active turn id `another-turn` but found `turn-2`",
    }),
    new RpcResponseError({
      code: -32600,
      data: undefined,
      message: "expected active turn id `turn-1` but found `turn-2`; response lost",
    }),
    new RpcResponseError({
      code: -32600,
      data: undefined,
      message: "expected active turn id `turn-1` but found `turn-2`\n",
    }),
  ])("preserves errors without an exact rejection guarantee: %s", async (error) => {
    const rpc = new FakeRpcClient([{ thread: nativeThread() }, error]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.startTask();
    await expect(provider.steerTurn("task-1", "turn-1", input)).rejects.toBe(error);
  });
});
