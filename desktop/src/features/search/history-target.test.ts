import { describe, expect, it } from "vitest";
import { resolveHistoryTarget } from "./history-target.js";
const location = { projectId: "p", taskId: "t", turnId: "turn", itemId: "original", turnCursor: "cursor", query: "搜索", snippet: "搜索结果正确", snippetMatchRange: { start: 0, end: 2 } };
function snapshot(texts: string[]) {
  return { turns: [{ id: "turn", status: "completed" as const, error: null, startedAt: null, completedAt: null, items: texts.map((text, i) => ({ id: `message-${i}`, type: "message" as const, role: "assistant" as const, text })) }] };
}
describe("history target identity", () => {
  it("does not mistake another occurrence of the same query for the target", () => {
    expect(resolveHistoryTarget(snapshot(["搜索失败"]), location)).toBeNull();
  });
  it("rejects ambiguous projected messages", () => {
    expect(resolveHistoryTarget(snapshot(["搜索结果正确", "搜索结果正确"]), location)).toBeNull();
  });
  it("resolves only the unique complete snippet within the same turn", () => {
    expect(resolveHistoryTarget(snapshot(["搜索失败", "搜索结果正确"]), location)?.itemId).toBe("message-1");
    expect(resolveHistoryTarget(snapshot(["搜索结果正确"]), { ...location, turnId: "other" })).toBeNull();
  });
});
