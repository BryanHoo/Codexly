import type { TerminalMetadata } from "../../protocol/project-terminal.js";

export type TerminalProjectState = Readonly<{
  terminals: readonly TerminalMetadata[];
  selectedId: string | null;
  visible: boolean;
  height: number;
  creating: boolean;
  error: string | null;
}>;

const EMPTY: TerminalProjectState = { terminals: [], selectedId: null, visible: false, height: 280, creating: false, error: null };

export class TerminalStore {
  private readonly projects = new Map<string, TerminalProjectState>();
  private readonly listeners = new Map<string, Set<() => void>>();

  get(projectId: string): TerminalProjectState { return this.projects.get(projectId) ?? EMPTY; }
  projectIds(): Iterable<string> { return this.projects.keys(); }

  subscribe(projectId: string, listener: () => void): () => void {
    const listeners = this.listeners.get(projectId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(projectId, listeners);
    return () => { listeners.delete(listener); if (listeners.size === 0) this.listeners.delete(projectId); };
  }

  liveCount(projectId: string): number {
    return this.get(projectId).terminals.filter((terminal) => terminal.state === "running" || terminal.state === "closing").length;
  }

  update(projectId: string, patch: Partial<TerminalProjectState>): void {
    const current = this.get(projectId);
    const next = { ...current, ...patch };
    if (Object.keys(patch).every((key) => current[key as keyof TerminalProjectState] === next[key as keyof TerminalProjectState])) return;
    if (!this.projects.has(projectId) && this.projects.size >= 128) {
      // 只淘汰无人订阅且没有会话的内存布局；运行中的终端永不因页面访问被淘汰。
      const stale = [...this.projects].find(([id, value]) => value.terminals.length === 0 && !value.creating && !this.listeners.has(id));
      if (stale !== undefined) this.projects.delete(stale[0]);
      else throw new Error("TERMINAL_LIMIT_REACHED");
    }
    this.projects.set(projectId, next);
    for (const listener of this.listeners.get(projectId) ?? []) listener();
  }

}

export const terminalStore = new TerminalStore();
