import type { AgentEvent } from "@/protocol/index.js";
import { describe, expect, it, vi } from "vitest";

import { createTaskItemStore } from "./task-store-core.js";

function delta(text: string): Extract<AgentEvent, { type: "message.delta" }> {
  return {
    type: "message.delta", payload: { delta: text }, version: 2, provider: "codex", sessionId: "s", taskId: "t",
    turnId: "turn", itemId: "message", sequence: 1, timestamp: "2026-09-05T00:00:00Z",
  };
}

describe("streamed item reads", () => {
  it("streams only the reasoning summary into its item", () => {
    const store = createTaskItemStore({ id: "reason", text: "", type: "reasoning" });
    expect(store.appendDelta({ ...delta(""), itemId: "reason", type: "reasoning.delta", payload: { delta: "**检查**" } })).toBe(true);
    expect(store.read()).toMatchObject({ text: "**检查**", type: "reasoning" });
    expect(store.readText()?.chunks.slice(0, store.readText()?.chunkCount).join("")).toBe("**检查**");
    store.replace({ id: "reason", text: "完整摘要", type: "reasoning" });
    expect(store.read()).toMatchObject({ text: "完整摘要" });
  });
  it("does not join historical chunks again after each read", () => {
    const store = createTaskItemStore({ id: "message", type: "message", role: "assistant", text: "" });
    const originalJoin = Array.prototype.join;
    let joinedCharacters = 0;
    const join = vi.spyOn(Array.prototype, "join").mockImplementation(function (this: string[], separator) {
      for (const text of this) if (typeof text === "string") joinedCharacters += text.length;
      return originalJoin.call(this, separator);
    });
    try {
      for (let index = 0; index < 200; index += 1) {
        store.appendDelta(delta("abcd"));
        store.read();
      }
    } finally {
      join.mockRestore();
    }
    expect(joinedCharacters).toBeLessThanOrEqual(1600);
    expect(store.read()).toMatchObject({ text: "abcd".repeat(200) });
  });

  it("keeps old items and snapshots stable and resets the stream on replacement", () => {
    const store = createTaskItemStore({ id: "message", type: "message", role: "assistant", text: "initial" });
    const original = store.read();
    const first = store.readText()!;
    store.appendDelta(delta(" addition"));
    const appended = store.read();
    expect(store.read()).toBe(appended);
    expect(original).toMatchObject({ text: "initial" });
    expect(first.chunks.slice(0, first.chunkCount).join("")).toBe("initial");
    expect(appended).toMatchObject({ text: "initial addition" });
    store.replace({ id: "message", type: "message", role: "assistant", text: "replaced" });
    store.appendDelta(delta(" next"));
    expect(store.read()).toMatchObject({ text: "replaced next" });
    expect(store.readText()!.chunks).not.toBe(first.chunks);
    expect(appended).toMatchObject({ text: "initial addition" });
  });

  it("appends plans across reads and retains accurate byte accounting", () => {
    const store = createTaskItemStore({ id: "message", type: "plan", text: "plan" });
    const bytes = store.getRetainedBytes();
    store.appendDelta({ ...delta(""), type: "plan.delta", payload: { delta: "中文" } });
    expect(store.read()).toMatchObject({ text: "plan中文" });
    store.appendDelta({ ...delta(""), type: "plan.delta", payload: { delta: " next" } });
    expect(store.read()).toMatchObject({ text: "plan中文 next" });
    expect(store.getRetainedBytes() - bytes).toBe(11);
  });

});
