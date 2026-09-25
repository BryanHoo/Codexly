import type { AgentItem } from "@/protocol/index.js";

export type AgentFileChange = Extract<AgentItem, { type: "file_change" }>["changes"][number] & Readonly<{ statsAvailable?: boolean }>;

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

export function getFileChangeStats(change: AgentFileChange): FileChangeStats {
  // Rust 已按来源格式统计；渲染和汇总只读取固定大小元数据。
  return change.stats;
}

export function summarizeFileChanges(changes: readonly AgentFileChange[]): FileChangeSummary {
  const uniqueChanges: AgentFileChange[] = [];
  const changeIndexByPath = new Map<string, number>();

  for (const change of changes) {
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
    const statistics = getFileChangeStats(change);
    additions += statistics.additions;
    removals += statistics.removals;
  }

  return { additions, changes: uniqueChanges, removals };
}
