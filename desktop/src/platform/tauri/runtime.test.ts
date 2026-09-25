import { beforeEach, describe, expect, it, vi } from "vitest";

let channelHandler: ((event: unknown) => void) | undefined;
const invoke = vi.fn(async (command: string) => ({
  lastSeq: command === "start_runtime" ? 2 : 1,
  provider: command === "start_runtime" ? "codex" : null,
  status: command === "start_runtime" ? "ready" : "idle",
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    public constructor(handler: (event: unknown) => void) {
      let deliveryId = 0;
      channelHandler = (event) => handler({ ...(event as object), streamId: 1, deliveryId: ++deliveryId });
    }
  },
  invoke,
}));

describe("Tauri runtime recovery", () => {
  beforeEach(() => {
    invoke.mockClear();
    vi.resetModules();
  });

  it("reconnects a recreated WebView without starting an already ready runtime", async () => {
    invoke.mockResolvedValueOnce({ lastSeq: 8, provider: "codex", status: "ready" });
    const runtime = await import("./runtime.js");

    expect(await runtime.ensureCodexRuntime()).toEqual({
      lastSeq: 8, provider: "codex", status: "ready",
    });
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(["connect_runtime"]);
  });

  it("starts a fresh runtime after the backend reports failure", async () => {
    const runtime = await import("./runtime.js");
    await runtime.ensureCodexRuntime();
    channelHandler?.({
      data: { provider: "codex", seq: 3, status: "failed" },
      type: "runtimeStatus",
    });
    await runtime.ensureCodexRuntime();

    expect(invoke.mock.calls.filter(([command]) => command === "start_runtime")).toHaveLength(2);
  });

  it("replays only the latest buffered agent events in sequence order", async () => {
    const runtime = await import("./runtime.js");
    await runtime.ensureCodexRuntime();
    for (let sequence = 1; sequence <= 1_025; sequence += 1) {
      channelHandler?.({
        data: { event: { sequence } },
        type: "agentEvent",
      });
    }

    const sequences: number[] = [];
    runtime.subscribeAgentEvents({
      afterSequence: 0,
      onEvent: (event) => sequences.push(event.sequence),
    });

    expect(sequences).toHaveLength(1_024);
    expect(sequences[0]).toBe(2);
    expect(sequences.at(-1)).toBe(1_025);
  });

  it("routes native retention overflow to resync subscribers", async () => {
    const runtime = await import("./runtime.js");
    await runtime.ensureCodexRuntime();
    const onResyncRequired = vi.fn();
    runtime.subscribeAgentEvents({
      afterSequence: 17,
      onEvent: vi.fn(),
      onResyncRequired,
    });

    channelHandler?.({
      data: {
        latestSequence: 17,
        projectId: "project-a",
        reason: "event_retention_exceeded",
        sessionId: "codeagent-runtime",
        type: "resync.required",
        version: 3,
      },
      type: "resyncRequired",
    });

    expect(onResyncRequired).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-a", type: "resync.required" }),
    );
  });

  it("acknowledges a packet only after synchronous subscribers consume it", async () => {
    const runtime = await import("./runtime.js");
    await runtime.ensureCodexRuntime();
    invoke.mockClear();
    runtime.subscribeAgentEvents({ afterSequence: 0, onEvent: () => {
      expect(invoke).not.toHaveBeenCalled();
    } });
    channelHandler?.({ type: "agentEvent", data: { event: { sequence: 1 } } });
    expect(invoke).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledWith("acknowledge_runtime_events", { streamId: 1, deliveryIds: [1] });
  });
});
