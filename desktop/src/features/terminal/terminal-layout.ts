import { terminalStore } from "./terminal-store.js";
import { loadTerminalPreferences } from "./terminal-preferences.js";

const layouts = new Map<string, Promise<void>>();

export function initializeTerminalLayout(projectId: string): Promise<void> {
  const existing = layouts.get(projectId);
  if (existing !== undefined) return existing;
  const loaded = loadTerminalPreferences(projectId).then((value) => { terminalStore.update(projectId, { visible: value.visible, height: value.height }); });
  if (layouts.size >= 128) { const oldest = layouts.keys().next().value; if (oldest !== undefined) layouts.delete(oldest); }
  layouts.set(projectId, loaded);
  return loaded;
}

export function terminalActionError(projectId: string, error: unknown): void {
  terminalStore.update(projectId, { error: error instanceof Error ? error.message : "TERMINAL_STREAM_INVALID" });
}
