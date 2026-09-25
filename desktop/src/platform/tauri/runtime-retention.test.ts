import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let channelHandler: ((event: unknown) => void) | undefined;
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    public constructor(handler: (event: unknown) => void) {
      let deliveryId = 0;
      channelHandler = (event) => handler({ ...(event as object), streamId: 1, deliveryId: ++deliveryId });
    }
  },
  invoke: vi.fn(async () => ({ lastSeq: 1, provider: "codex", status: "ready" })),
}));

describe("runtime event retention", () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  function deliver(sequence: number, bytes: number): void {
    channelHandler?.({
      type: "agentEvent",
      data: { event: { sequence, sessionId: "session", taskId: "task", payload: { delta: "x".repeat(bytes) } } },
    });
  }

  it("bounds replay payload bytes even below the event count limit", async () => {
    const runtime = await import("./runtime.js");
    await runtime.ensureCodexRuntime();
    for (let sequence = 1; sequence <= 10; sequence += 1) deliver(sequence, 1_048_576);
    const onEvent = vi.fn();
    runtime.subscribeAgentEvents({ afterSequence: 0, onEvent });
    expect(onEvent.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("reports an oversized final event as a replay gap", async () => {
    const runtime = await import("./runtime.js");
    await runtime.ensureCodexRuntime();
    deliver(1, 5 * 1_048_576);
    const subscription = { afterSequence: 0, onEvent: vi.fn(), onReplayGap: vi.fn() };
    runtime.subscribeAgentEvents(subscription);
    expect(subscription.onEvent).not.toHaveBeenCalled();
    expect(subscription.onReplayGap).toHaveBeenCalledWith(expect.objectContaining({ sequence: 1, taskId: "task" }));
    const recovered = { afterSequence: 1, onEvent: vi.fn(), onReplayGap: vi.fn() };
    runtime.subscribeAgentEvents(recovered);
    expect(recovered.onReplayGap).not.toHaveBeenCalled();
  });

  it("releases idle payloads while retaining recovery checkpoints", async () => {
    const runtime = await import("./runtime.js");
    await runtime.ensureCodexRuntime();
    deliver(1, 1_048_576);
    await vi.advanceTimersByTimeAsync(120_000);
    const subscription = { afterSequence: 0, onEvent: vi.fn(), onReplayGap: vi.fn() };
    runtime.subscribeAgentEvents(subscription);
    expect(subscription.onEvent).not.toHaveBeenCalled();
    expect(subscription.onReplayGap).toHaveBeenCalledTimes(1);
  });
});
