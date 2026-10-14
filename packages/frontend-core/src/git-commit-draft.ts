export type CommitFileEntry = Readonly<{ path: string; staged: boolean; unstaged: boolean }>;
export type CommitDraft = Readonly<{
  snapshot: string;
  message: string;
  selectedPaths: ReadonlySet<string>;
  knownPaths: ReadonlySet<string>;
  previousMessage: string | null;
}>;

export function createCommitDraft(
  snapshot: string,
  entries: readonly CommitFileEntry[],
  stored?: Pick<CommitDraft, "message" | "previousMessage"> | null,
): CommitDraft {
  // 每次打开默认选择当前全部文件，只恢复文本和撤销内容，不恢复上次的排除选择。
  return {
    snapshot,
    message: stored?.message ?? "",
    selectedPaths: new Set(entries.map((entry) => entry.path)),
    knownPaths: new Set(entries.map((entry) => entry.path)),
    previousMessage: stored?.previousMessage ?? null,
  };
}

export function reconcileCommitDraft(
  draft: CommitDraft,
  snapshot: string,
  entries: readonly CommitFileEntry[],
  complete = true,
): CommitDraft {
  const paths = new Set(entries.map((entry) => entry.path));
  // 初始详情可能晚于面板打开，首批文件到达时补足默认全选；此后刷新保留手动排除。
  // 分页尚未完成时保留离页选择，后续新文件或新页面不自动加入本次提交。
  const selectedPaths =
    draft.knownPaths.size === 0
      ? paths
      : complete
        ? new Set([...draft.selectedPaths].filter((path) => paths.has(path)))
        : draft.selectedPaths;
  return {
    ...draft,
    snapshot,
    selectedPaths,
    knownPaths: new Set([...draft.knownPaths, ...paths]),
  };
}

export function applyGeneratedCommitMessage(
  current: CommitDraft,
  requested: CommitDraft,
  message: string,
): CommitDraft {
  const sameRange =
    current.snapshot === requested.snapshot &&
    current.selectedPaths.size === requested.selectedPaths.size &&
    [...current.selectedPaths].every((path) => requested.selectedPaths.has(path));
  // 只应用相同提交范围的结果；用户点击生成即授权替换当前全文，替换前的内容保留用于撤销。
  if (!sameRange) return current;
  return { ...current, message, previousMessage: current.message };
}

export function serializeCommitDraft(draft: CommitDraft): string {
  return JSON.stringify({
    version: 1,
    snapshot: draft.snapshot,
    message: draft.message,
    selectedPaths: [...draft.selectedPaths],
    knownPaths: [...draft.knownPaths],
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
      !optionalText(parsed["previousMessage"])
    )
      return null;
    return {
      snapshot: parsed["snapshot"],
      message: parsed["message"],
      selectedPaths: new Set(parsed["selectedPaths"]),
      knownPaths: new Set(parsed["knownPaths"]),
      previousMessage: parsed["previousMessage"] as string | null,
    };
  } catch {
    return null;
  }
}
