export type CommitFileEntry = Readonly<{ path: string; staged: boolean; unstaged: boolean }>;
export type CommitDraft = Readonly<{
  snapshot: string;
  message: string;
  selectedPaths: ReadonlySet<string>;
  knownPaths: ReadonlySet<string>;
  needsReview: boolean;
  suggestion: string | null;
  previousMessage: string | null;
}>;

export function createCommitDraft(
  snapshot: string,
  entries: readonly CommitFileEntry[],
): CommitDraft {
  const staged = entries.filter((entry) => entry.staged);
  // 尊重用户已有的暂存范围；没有暂存时才选择首次看到的全部变更。
  return {
    snapshot,
    message: "",
    selectedPaths: new Set((staged.length ? staged : entries).map((entry) => entry.path)),
    knownPaths: new Set(entries.map((entry) => entry.path)),
    needsReview: false,
    suggestion: null,
    previousMessage: null,
  };
}

export function reconcileCommitDraft(
  draft: CommitDraft,
  snapshot: string,
  entries: readonly CommitFileEntry[],
  complete = true,
): CommitDraft {
  const paths = new Set(entries.map((entry) => entry.path));
  // 分页尚未完成时保留离页选择；新文件只记录，不静默加入本次提交。
  const selectedPaths = complete
    ? new Set([...draft.selectedPaths].filter((path) => paths.has(path)))
    : draft.selectedPaths;
  return {
    ...draft,
    snapshot,
    selectedPaths,
    knownPaths: new Set([...draft.knownPaths, ...paths]),
    needsReview: draft.needsReview || draft.snapshot !== snapshot,
  };
}

export function receiveCommitSuggestion(
  current: CommitDraft,
  requested: CommitDraft,
  message: string,
): CommitDraft {
  const sameRange =
    current.snapshot === requested.snapshot &&
    current.selectedPaths.size === requested.selectedPaths.size &&
    [...current.selectedPaths].every((path) => requested.selectedPaths.has(path));
  // 迟到结果不能用于新的提交范围，也不能覆盖请求期间的用户输入。
  if (!sameRange) return { ...current, needsReview: true };
  if (current.message !== "" || current.message !== requested.message)
    return { ...current, suggestion: message };
  return { ...current, message, previousMessage: current.message, suggestion: null };
}

export function serializeCommitDraft(draft: CommitDraft): string {
  return JSON.stringify({
    version: 1,
    snapshot: draft.snapshot,
    message: draft.message,
    selectedPaths: [...draft.selectedPaths],
    knownPaths: [...draft.knownPaths],
    needsReview: draft.needsReview,
    suggestion: draft.suggestion,
    previousMessage: draft.previousMessage,
  });
}

export function parseCommitDraft(value: string | null): CommitDraft | null {
  if (value === null || value.length > 2_000_000) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const paths = (input: unknown): input is string[] =>
      Array.isArray(input) &&
      input.length <= 100_000 &&
      input.every((path) => typeof path === "string");
    const optionalText = (input: unknown) =>
      input === null || (typeof input === "string" && input.length <= 10_000);
    if (
      parsed["version"] !== 1 ||
      typeof parsed["snapshot"] !== "string" ||
      typeof parsed["message"] !== "string" ||
      parsed["message"].length > 10_000 ||
      !paths(parsed["selectedPaths"]) ||
      !paths(parsed["knownPaths"]) ||
      typeof parsed["needsReview"] !== "boolean" ||
      !optionalText(parsed["suggestion"]) ||
      !optionalText(parsed["previousMessage"])
    )
      return null;
    return {
      snapshot: parsed["snapshot"],
      message: parsed["message"],
      selectedPaths: new Set(parsed["selectedPaths"]),
      knownPaths: new Set(parsed["knownPaths"]),
      needsReview: parsed["needsReview"],
      suggestion: parsed["suggestion"] as string | null,
      previousMessage: parsed["previousMessage"] as string | null,
    };
  } catch {
    return null;
  }
}
