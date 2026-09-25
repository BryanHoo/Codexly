import type { TerminalMetadata, TerminalScope, TerminalSnapshot } from "../../protocol/project-terminal.js";
import type { TerminalStore } from "./terminal-store.js";

// 会话归并只随终端运行时加载；工作台冷路径只订阅数量和布局。
export function upsertTerminal(store: TerminalStore, metadata: TerminalMetadata): void {
  const current = store.get(metadata.projectId);
  const index = current.terminals.findIndex((terminal) => terminal.terminalId === metadata.terminalId);
  const terminals = [...current.terminals];
  if (index < 0) terminals.push(metadata); else terminals[index] = metadata;
  store.update(metadata.projectId, { terminals, selectedId: current.selectedId ?? metadata.terminalId });
}

export function removeTerminalMetadata(store: TerminalStore, scope: TerminalScope): void {
  const current = store.get(scope.projectId);
  const terminals = current.terminals.filter((terminal) => terminal.terminalId !== scope.terminalId || terminal.generation !== scope.generation);
  if (terminals.length === current.terminals.length) return;
  // 最后一个会话移除时同步收起区域，其他会话仍沿用当前显隐状态。
  store.update(scope.projectId, { terminals, visible: terminals.length > 0 && current.visible, selectedId: terminals.some((terminal) => terminal.terminalId === current.selectedId) ? current.selectedId : terminals.at(-1)?.terminalId ?? null });
}

export function applyTerminalSnapshot(store: TerminalStore, snapshot: TerminalSnapshot): void {
  const grouped = new Map<string, TerminalMetadata[]>();
  for (const metadata of snapshot.terminals) {
    const terminals = grouped.get(metadata.projectId) ?? [];
    terminals.push(metadata);
    grouped.set(metadata.projectId, terminals);
  }
  for (const projectId of new Set([...store.projectIds(), ...grouped.keys()])) {
    const terminals = grouped.get(projectId) ?? [];
    const selectedId = store.get(projectId).selectedId;
    store.update(projectId, { terminals, selectedId: terminals.some((terminal) => terminal.terminalId === selectedId) ? selectedId : terminals[0]?.terminalId ?? null, creating: false });
  }
}
