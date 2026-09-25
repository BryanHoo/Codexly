import { describe, expect, it } from "vitest";
import { applyTaskWindowPacket, emptyTaskWindowState } from "./task-window-model.js";

describe("task window projection", () => {
  it("applies append, replacement, eviction and ignores stale packets", () => {
    const initial = applyTaskWindowPacket(emptyTaskWindowState, { sequence: 1, title: "Task", status: "running", order: ["a"], updates: [{ id: "a", kind: "message", text: "Hello", append: false }], truncated: false });
    const appended = applyTaskWindowPacket(initial, { sequence: 2, title: "Task", status: "running", order: ["a"], updates: [{ id: "a", kind: "message", text: " world", append: true }], truncated: false });
    expect(appended.rows[0]?.text).toBe("Hello world");
    expect(applyTaskWindowPacket(appended, { sequence: 1, title: "Old", status: "idle", order: [], updates: [], truncated: false })).toBe(appended);
    const replaced = applyTaskWindowPacket(appended, { sequence: 3, title: "Task", status: "completed", order: ["b"], updates: [{ id: "b", kind: "message", text: "Final", append: false }], truncated: true });
    expect(replaced.rows).toEqual([{ id: "b", kind: "message", text: "Final" }]);
  });

  it("preserves unchanged row references while status changes", () => {
    const initial = applyTaskWindowPacket(emptyTaskWindowState, { sequence: 1, title: "Task", status: "running", order: ["a"], updates: [{ id: "a", kind: "message", text: "Hello", append: false }], truncated: false });
    const updated = applyTaskWindowPacket(initial, { sequence: 2, title: "Task", status: "completed", order: ["a"], updates: [], truncated: false });
    expect(updated.rows[0]).toBe(initial.rows[0]);
  });
});
