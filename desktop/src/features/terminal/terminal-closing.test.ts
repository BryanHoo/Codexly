import { describe, expect, it, vi } from "vitest";
import { TerminalRuntime } from "./terminal-runtime.js";
import { TerminalStore } from "./terminal-store.js";
import type { EmulatorCallbacks } from "./terminal-emulator.js";
import type { TerminalControlEvent, TerminalMetadata } from "../../protocol/project-terminal.js";

const metadata: TerminalMetadata = { projectId: "p", rootId: "r", terminalId: "t", generation: "g", title: "sh", state: "running", cols: 80, rows: 24, exitCode: null };

function setup() {
  let event: (value: TerminalControlEvent) => void = () => undefined;
  let callbacks: EmulatorCallbacks | undefined;
  const release = vi.fn();
  const client = {
    connect: vi.fn(async (snapshot, receive) => { event = receive; snapshot({ generation: "g", sequence: "0", terminals: [] }); return vi.fn(); }),
    create: vi.fn(async () => ({ metadata, dispose: release })),
    write: vi.fn(async (): Promise<void> => undefined), ack: vi.fn(async () => undefined), resize: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined), remove: vi.fn(async () => undefined),
  };
  const emulator = { write: vi.fn(), attach: vi.fn(), detach: vi.fn(), focus: vi.fn(), setExited: vi.fn(), dispose: vi.fn() };
  const store = new TerminalStore();
  store.update("p", { visible: true });
  const runtime = new TerminalRuntime({ client, store, factory: async (value) => { callbacks = value; return emulator; } });
  return { runtime, client, store, emulator, release, event: (value: TerminalControlEvent) => event(value), input: () => callbacks?.data("x") };
}

describe("terminal closing", () => {
  it("clears a confirmed close without an exit event and ignores delayed closing events", async () => {
    const test = setup();
    await test.runtime.create("p", "r");
    await test.runtime.close(metadata);
    test.event({ type: "stateChanged", sequence: "1", data: { ...metadata, state: "closing" } });
    expect(test.store.get("p")).toMatchObject({ terminals: [], selectedId: null, visible: false });
    expect(test.store.liveCount("p")).toBe(0);
    expect(test.client.remove).toHaveBeenCalledWith(metadata);
    expect(test.release).toHaveBeenCalledOnce();
    expect(test.emulator.dispose).toHaveBeenCalledOnce();
    test.runtime.dispose();
  });

  it.each(["command", "event"])("stops input and ignores its late rejection during closing by %s", async (mode) => {
    const test = setup();
    let reject: (error: Error) => void = () => undefined;
    test.client.write.mockImplementation(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    await test.runtime.create("p", "r");
    test.input();
    await Promise.resolve();
    if (mode === "command") await test.runtime.close(metadata);
    else test.event({ type: "stateChanged", sequence: "1", data: { ...metadata, state: "closing" } });
    reject(Object.assign(new Error("terminal owner is closing"), { code: "TERMINAL_OWNER_CLOSING" }));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    test.input();
    expect(test.store.get("p").error).toBeNull();
    expect(test.client.write).toHaveBeenCalledOnce();
    expect(test.client.close).toHaveBeenCalledTimes(mode === "command" ? 1 : 0);
    test.runtime.dispose();
  });

  it("retains a failed cleanup for retry", async () => {
    const test = setup();
    test.client.close.mockRejectedValueOnce(new Error("TERMINAL_CLEANUP_FAILED"));
    await test.runtime.create("p", "r");
    await expect(test.runtime.close(metadata)).rejects.toThrow("TERMINAL_CLEANUP_FAILED");
    expect(test.store.liveCount("p")).toBe(1);
    expect(test.emulator.dispose).not.toHaveBeenCalled();
    await test.runtime.close(metadata);
    expect(test.store.liveCount("p")).toBe(0);
    test.runtime.dispose();
  });
});
