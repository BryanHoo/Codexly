import type { TerminalScope } from "../../protocol/project-terminal.js";
import type { TerminalRuntime } from "./terminal-runtime.js";
import { terminalStore } from "./terminal-store.js";
import { initializeTerminalLayout, terminalActionError } from "./terminal-layout.js";
import { saveTerminalPreferences } from "./terminal-preferences-write.js";

let loading: Promise<TerminalRuntime> | undefined;

export function persistTerminalLayout(projectId: string): void {
  const state = terminalStore.get(projectId);
  void saveTerminalPreferences(projectId, { visible: state.visible, height: state.height, selectedIndex: Math.max(0, state.terminals.findIndex((terminal) => terminal.terminalId === state.selectedId)) }).catch((error: unknown) => terminalActionError(projectId, error));
}

export function loadTerminalRuntime(): Promise<TerminalRuntime> {
  loading ??= import("./terminal-runtime.js").then((module) => module.terminalRuntime).catch((error: unknown) => { loading = undefined; throw error; });
  return loading;
}

export async function createTerminal(projectId: string, rootId: string | undefined): Promise<void> {
  if (rootId === undefined) { terminalActionError(projectId, new Error("TERMINAL_ROOT_INVALID")); return; }
  try { await (await loadTerminalRuntime()).create(projectId, rootId); persistTerminalLayout(projectId); }
  catch (error) { terminalActionError(projectId, error); }
}

export async function toggleTerminal(projectId: string, rootId: string | undefined): Promise<void> {
  await initializeTerminalLayout(projectId);
  const state = terminalStore.get(projectId);
  terminalStore.update(projectId, { visible: !state.visible });
  persistTerminalLayout(projectId);
  if (!state.visible && state.terminals.length === 0) await createTerminal(projectId, rootId);
}

export async function closeTerminal(scope: TerminalScope): Promise<void> {
  try { await (await loadTerminalRuntime()).close(scope); } catch (error) { terminalActionError(scope.projectId, error); }
}
export async function removeTerminal(scope: TerminalScope): Promise<void> {
  try { await (await loadTerminalRuntime()).remove(scope); } catch (error) { terminalActionError(scope.projectId, error); }
}
