import { useEffect, useState } from "react";
import {
  readGitReceipt,
  writeGitReceipt,
  type GitReceipt,
} from "@codexly/frontend-core/git-operation-receipt";

export function useGitOperationReceipt(
  scope: string,
  current: GitReceipt | null,
  head?: string | null,
) {
  const key = `codexly:git-receipt:v1:${scope}`;
  const [stored, setStored] = useState(() => {
    try {
      return typeof window === "undefined"
        ? null
        : readGitReceipt(window.localStorage.getItem(key), head);
    } catch {
      return null;
    }
  });
  const signature = current ? writeGitReceipt(current) : null;
  useEffect(() => {
    if (!signature) return;
    const next = readGitReceipt(signature);
    setStored(next);
    try {
      window.localStorage.setItem(key, signature);
    } catch {
      /* 回执持久化失败不改变已完成的 Git 操作。 */
    }
  }, [key, signature]);
  return (
    current ??
    (stored && (head === undefined || stored.head === null || stored.head === head) ? stored : null)
  );
}
