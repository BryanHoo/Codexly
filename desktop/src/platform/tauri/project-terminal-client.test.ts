import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectTerminalClient } from "./project-terminal-client.js";
import type { NativeInvoke } from "./native-invoke.js";

describe("native terminal client", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("rejects an event from another generation before applying it", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: { transformCallback: () => 1, unregisterCallback: vi.fn() } });
    const invoke = vi.fn(async (_command: string, args: { onEvent: { onmessage: (value: unknown) => void } }) => {
      args.onEvent.onmessage({ sequence: "1", type: "removed", data: { projectId: "p", terminalId: "t", generation: "old" } });
      return { generation: "g", sequence: "0", terminals: [] };
    });
    const event = vi.fn();
    const client = new ProjectTerminalClient(invoke as unknown as NativeInvoke);
    await expect(client.connect(vi.fn(), event, vi.fn())).rejects.toThrow("TERMINAL_SCOPE_MISMATCH");
    expect(event).not.toHaveBeenCalled();
  });
  it("does not apply a snapshot after an invalid early event", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: { transformCallback: () => 1, unregisterCallback: vi.fn() } });
    const invoke = vi.fn(async (_command: string, args: { onEvent: { onmessage: (value: unknown) => void } }) => {
      args.onEvent.onmessage({ invalid: true });
      return { generation: "g", sequence: "0", terminals: [] };
    });
    const snapshot = vi.fn();
    const fail = vi.fn();
    const client = new ProjectTerminalClient(invoke as unknown as NativeInvoke);
    await expect(client.connect(snapshot, vi.fn(), fail)).rejects.toThrow("TERMINAL_STREAM_INVALID");
    expect(snapshot).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledOnce();
  });
  it("rejects metadata from another creation scope", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: { transformCallback: () => 1, unregisterCallback: vi.fn() } });
    const invoke = vi.fn(async () => ({ projectId: "other", rootId: "r", terminalId: "t", generation: "g", title: "sh", state: "running", cols: 80, rows: 24, exitCode: null }));
    const client = new ProjectTerminalClient(invoke as NativeInvoke);
    await expect(client.create({ projectId: "p", rootId: "r", requestId: "q", generation: "g", cols: 80, rows: 24 }, vi.fn())).rejects.toThrow("TERMINAL_SCOPE_MISMATCH");
  });
  it("sends raw bytes with encoded scope and cumulative sequence", async () => {
    const invoke = vi.fn(async () => undefined);
    const client = new ProjectTerminalClient(invoke as NativeInvoke);
    const scope = { projectId: "项目", terminalId: "t", generation: "g" };
    const bytes = new Uint8Array([0, 255, 3]);
    await client.write(scope, 9007199254740993n, bytes);
    expect(invoke).toHaveBeenCalledWith("write_project_terminal", bytes, { headers: {
      "x-codeagent-project-id": "%E9%A1%B9%E7%9B%AE", "x-codeagent-terminal-id": "t", "x-codeagent-generation": "g", "x-codeagent-input-sequence": "9007199254740993",
    } });
  });
  it("rejects oversized input before invoke and preserves native error codes", async () => {
    const invoke = vi.fn(async () => { throw { code: "TERMINAL_INPUT_QUEUE_FULL", message: "queue full" }; });
    const client = new ProjectTerminalClient(invoke as NativeInvoke);
    const scope = { projectId: "p", terminalId: "t", generation: "g" };
    await expect(client.write(scope, 1n, new Uint8Array(16385))).rejects.toThrow("TERMINAL_INPUT_TOO_LARGE");
    expect(invoke).not.toHaveBeenCalled();
    await expect(client.write(scope, 1n, new Uint8Array([1]))).rejects.toMatchObject({ code: "TERMINAL_INPUT_QUEUE_FULL", message: "queue full" });
  });
});
