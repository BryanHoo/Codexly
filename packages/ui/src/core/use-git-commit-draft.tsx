import { useEffect, useMemo, useRef, useState } from "react";
import {
  createCommitDraft,
  parseCommitDraft,
  reconcileCommitDraft,
  serializeCommitDraft,
  type CommitDraft,
  type CommitFileEntry,
} from "@codexly/frontend-core/git-commit-draft";

function restore(key: string, snapshot: string, entries: readonly CommitFileEntry[]) {
  try {
    const stored =
      typeof window === "undefined" ? null : parseCommitDraft(window.localStorage.getItem(key));
    return createCommitDraft(snapshot, entries, stored);
  } catch {
    return createCommitDraft(snapshot, entries);
  }
}

/** 草稿身份只包含仓库/工作树/分支，不能使用不断变化的 Git 快照作为存储身份。 */
export function useGitCommitDraft(
  scope: string,
  snapshot: string,
  entries: readonly CommitFileEntry[],
  complete: boolean,
) {
  const key = `codexly:git-draft:v1:${scope}`;
  const range = useMemo(
    () =>
      `${snapshot}:${entries.map((entry) => `${entry.path}:${String(Number(entry.staged))}`).join("\0")}:${String(complete)}`,
    [snapshot, entries, complete],
  );
  const [state, setState] = useState(() => ({
    range,
    draft: restore(key, snapshot, entries),
  }));
  if (state.range !== range)
    setState({ range, draft: reconcileCommitDraft(state.draft, snapshot, entries, complete) });
  const latest = useRef(state.draft);
  latest.current = state.draft;
  const save = () => {
    try {
      window.localStorage.setItem(key, serializeCommitDraft(latest.current));
    } catch {
      /* 存储不可用时保留内存草稿，不阻断提交。 */
    }
  };
  useEffect(() => {
    // 合并键入期间的写盘；卸载和页面离开时补存最新内容。
    const timer = setTimeout(save, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [key, state.draft]);
  useEffect(() => {
    const flush = () => {
      save();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [key]);
  const update = (transform: (draft: CommitDraft) => CommitDraft) => {
    setState((current) => ({ ...current, draft: transform(current.draft) }));
  };
  return [state.draft, update] as const;
}
