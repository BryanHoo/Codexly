import { describe, expect, it } from "vitest";
import {
  createCommitDraft,
  reconcileCommitDraft,
  receiveCommitSuggestion,
  parseCommitDraft,
  serializeCommitDraft,
} from "./git-commit-draft.js";

const files = [
  { path: "a.ts", staged: true, unstaged: true },
  { path: "b.ts", staged: false, unstaged: true },
] as const;

describe("commit drafts", () => {
  it("respects an existing staged selection", () => {
    expect([...createCommitDraft("one", files).selectedPaths]).toEqual(["a.ts"]);
  });
  it("keeps text and exclusions across snapshots without adding new changes", () => {
    const draft = {
      ...createCommitDraft("one", files),
      message: "fix(git): 保留草稿",
      selectedPaths: new Set<string>(),
    };
    const next = reconcileCommitDraft(draft, "two", [
      ...files,
      { path: "c.ts", staged: false, unstaged: true },
    ]);
    expect(next.message).toBe(draft.message);
    expect([...next.selectedPaths]).toEqual([]);
    expect(next.needsReview).toBe(true);
  });
  it("preserves unloaded selections while a paged status is incomplete", () => {
    const draft = { ...createCommitDraft("one", files), selectedPaths: new Set(["a.ts", "b.ts"]) };
    expect([...reconcileCommitDraft(draft, "two", [files[0]], false).selectedPaths]).toEqual([
      "a.ts",
      "b.ts",
    ]);
    expect([...reconcileCommitDraft(draft, "two", [files[0]], true).selectedPaths]).toEqual([
      "a.ts",
    ]);
  });
  it("round trips a persisted draft and rejects invalid storage", () => {
    const draft = { ...createCommitDraft("one", files), message: "fix(git): 保留草稿" };
    expect(parseCommitDraft(serializeCommitDraft(draft))).toEqual(draft);
    expect(parseCommitDraft('{"version":99}')).toBeNull();
    expect(parseCommitDraft("not-json")).toBeNull();
  });
  it("offers a suggestion instead of replacing edits made during generation", () => {
    const initial = createCommitDraft("one", files);
    const edited = { ...initial, message: "手写信息" };
    const next = receiveCommitSuggestion(edited, initial, "fix(git): 生成建议");
    expect(next.message).toBe("手写信息");
    expect(next.suggestion).toBe("fix(git): 生成建议");
  });
  it("inserts an empty-draft suggestion with undo and rejects a stale range", () => {
    const initial = createCommitDraft("one", files);
    const next = receiveCommitSuggestion(initial, initial, "fix(git): 生成建议");
    expect(next.message).toBe("fix(git): 生成建议");
    expect(next.previousMessage).toBe("");
    const changed = reconcileCommitDraft(initial, "two", files);
    expect(receiveCommitSuggestion(changed, initial, "过期建议").message).toBe("");
  });
});
