import { describe, expect, it, vi } from "vitest";
import { TerminalStore } from "./terminal-store.js";
import { applyTerminalSnapshot, removeTerminalMetadata, upsertTerminal } from "./terminal-sessions.js";
import type { TerminalMetadata } from "../../protocol/project-terminal.js";

const metadata = (projectId: string, terminalId: string): TerminalMetadata => ({ projectId, terminalId, generation: "g", rootId: "r", title: "sh", state: "running", cols: 80, rows: 24, exitCode: null });

describe("project terminal metadata", () => {
  it("notifies only the owning project and counts closing but not exited sessions", () => {
    const store = new TerminalStore();
    const first = vi.fn();
    const second = vi.fn();
    store.subscribe("a", first);
    store.subscribe("b", second);
    upsertTerminal(store, metadata("a", "1"));
    upsertTerminal(store, { ...metadata("a", "1"), state: "closing" });
    expect(store.liveCount("a")).toBe(1);
    expect(store.liveCount("b")).toBe(0);
    upsertTerminal(store, { ...metadata("a", "1"), state: "exited" });
    expect(store.liveCount("a")).toBe(0);
    expect(first).toHaveBeenCalledTimes(3);
    expect(second).not.toHaveBeenCalled();
  });
  it("retains layout but clears stale sessions when generation changes", () => {
    const store = new TerminalStore();
    store.update("a", { visible: true, height: 320 });
    upsertTerminal(store, metadata("a", "1"));
    applyTerminalSnapshot(store, { generation: "next", sequence: "0", terminals: [] });
    expect(store.get("a")).toMatchObject({ visible: true, height: 320, terminals: [], selectedId: null });
  });
  it("selects another retained tab when the selected tab is removed", () => {
    const store = new TerminalStore();
    upsertTerminal(store, metadata("a", "1"));
    upsertTerminal(store, metadata("a", "2"));
    store.update("a", { selectedId: "2", visible: true });
    removeTerminalMetadata(store, { projectId: "a", terminalId: "2", generation: "g" });
    expect(store.get("a").selectedId).toBe("1");
    expect(store.get("a").visible).toBe(true);
    removeTerminalMetadata(store, { projectId: "a", terminalId: "1", generation: "g" });
    expect(store.get("a")).toMatchObject({ selectedId: null, visible: false });
  });
});
