import { describe, expect, it } from "vitest";
import {
  createCommitDraft,
  reconcileCommitDraft,
  applyGeneratedCommitMessage,
  parseCommitDraft,
  serializeCommitDraft,
} from "./git-commit-draft.js";

const files = [
  { path: "a.ts", staged: true, unstaged: true },
  { path: "b.ts", staged: false, unstaged: true },
] as const;

describe("commit drafts", () => {
  it("defaults to all staged and unstaged files when opening", () => {
    expect([...createCommitDraft("one", files).selectedPaths]).toEqual(["a.ts", "b.ts"]);
  });
  it("reopens with all current files selected while keeping the message and undo", () => {
    const stored = {
      ...createCommitDraft("one", files),
      message: "保留提交信息",
      previousMessage: "生成前原文",
      selectedPaths: new Set<string>(),
    };
    const opened = createCommitDraft("two", files, stored);
    expect([...opened.selectedPaths]).toEqual(["a.ts", "b.ts"]);
    expect(opened.message).toBe(stored.message);
    expect(opened.previousMessage).toBe(stored.previousMessage);
  });
  it("selects the first loaded files when opening before details arrive", () => {
    const initial = createCommitDraft("one", []);
    const loaded = reconcileCommitDraft(initial, "one", files, false);
    expect([...loaded.selectedPaths]).toEqual(["a.ts", "b.ts"]);
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
    expect(next).not.toHaveProperty("needsReview");
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
  it("directly replaces edits made during generation and keeps them for undo", () => {
    const initial = createCommitDraft("one", files);
    const edited = { ...initial, message: "手写信息" };
    const next = applyGeneratedCommitMessage(edited, initial, "fix(git): 生成建议");
    expect(next.message).toBe("fix(git): 生成建议");
    expect(next.previousMessage).toBe("手写信息");
  });
  it("directly replaces an existing draft without a confirmation step", () => {
    const initial = { ...createCommitDraft("one", files), message: "原有提交信息" };
    const next = applyGeneratedCommitMessage(initial, initial, "fix(git): 自动填写提交信息");
    expect(next.message).toBe("fix(git): 自动填写提交信息");
    expect(next.previousMessage).toBe("原有提交信息");
  });
  it("preserves text when the selection changes during generation", () => {
    const initial = { ...createCommitDraft("one", files), message: "原有提交信息" };
    const changed = { ...initial, selectedPaths: new Set(["b.ts"]) };
    const next = applyGeneratedCommitMessage(changed, initial, "过期结果");
    expect(next.message).toBe("原有提交信息");
    expect(next.previousMessage).toBeNull();
    expect(next).toBe(changed);
  });
  it("loads legacy drafts without restoring a pending suggestion", () => {
    const initial = { ...createCommitDraft("one", files), message: "原有提交信息" };
    const legacy = JSON.stringify({
      ...(JSON.parse(serializeCommitDraft(initial)) as Record<string, unknown>),
      suggestion: "旧版建议",
      needsReview: true,
    });
    const next = parseCommitDraft(legacy);
    expect(next?.message).toBe(initial.message);
    expect(next).not.toHaveProperty("suggestion");
    expect(next).not.toHaveProperty("needsReview");
  });
  it("inserts an empty-draft suggestion with undo and rejects a stale range", () => {
    const initial = createCommitDraft("one", files);
    const next = applyGeneratedCommitMessage(initial, initial, "fix(git): 生成建议");
    expect(next.message).toBe("fix(git): 生成建议");
    expect(next.previousMessage).toBe("");
    const changed = reconcileCommitDraft(initial, "two", files);
    expect(applyGeneratedCommitMessage(changed, initial, "过期建议").message).toBe("");
  });
});
