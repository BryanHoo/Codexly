import { isEmptyFileUpdate } from "@codexly/frontend-core/file-change-visibility";
import { isVisibleProjectPath } from "@codexly/frontend-core/project-file-visibility";
import type { AgentItem } from "@codexly/protocol";

export type AgentFileChange = Extract<AgentItem, { type: "file_change" }>["changes"][number];

export type FileChangeStats = Readonly<{
  additions: number;
  removals: number;
}>;

export type FileChangeSummary = Readonly<{
  additions: number;
  changes: readonly AgentFileChange[];
  removals: number;
}>;

export function getFileName(filePath: string): string {
  return filePath.split(/[\\/]/).at(-1) ?? filePath;
}

export function countFileChangeLines(change: AgentFileChange): FileChangeStats {
  let additions = 0;
  let removals = 0;

  // 只统计补丁正文，避免把 Unified Diff 的文件头误计为代码变更。
  for (const line of change.diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removals += 1;
    }
  }

  return { additions, removals };
}

export function summarizeFileChanges(changes: readonly AgentFileChange[]): FileChangeSummary {
  const uniqueChanges: AgentFileChange[] = [];
  const changeIndexByPath = new Map<string, number>();

  for (const change of changes) {
    if (!isVisibleProjectPath(change.path) || isEmptyFileUpdate(change)) continue;
    const normalizedPath = change.path.replaceAll("\\", "/");
    const existingIndex = changeIndexByPath.get(normalizedPath);
    if (existingIndex === undefined) {
      changeIndexByPath.set(normalizedPath, uniqueChanges.length);
      uniqueChanges.push(change);
    } else {
      // 同一回复重复编辑同一文件时，卡片保留首次位置并审核最终 Diff。
      uniqueChanges[existingIndex] = change;
    }
  }

  let additions = 0;
  let removals = 0;
  for (const change of uniqueChanges) {
    const statistics = countFileChangeLines(change);
    additions += statistics.additions;
    removals += statistics.removals;
  }

  return { additions, changes: uniqueChanges, removals };
}
