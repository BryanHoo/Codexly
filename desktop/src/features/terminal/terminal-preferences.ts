import { appPreferenceStorage } from "../../platform/tauri/app-storage.js";

export type TerminalPreferences = { visible: boolean; height: number; selectedIndex: number };
const DEFAULT: TerminalPreferences = { visible: false, height: 280, selectedIndex: 0 };

export function terminalPreferenceKey(projectId: string): Promise<string> {
  const key = crypto.subtle.digest("SHA-256", new TextEncoder().encode(projectId)).then((digest) => {
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `codeagent.project-terminal.${hex}`;
  });
  return key;
}

export async function loadTerminalPreferences(projectId: string): Promise<TerminalPreferences> {
  const stored = appPreferenceStorage.getItem(await terminalPreferenceKey(projectId));
  if (stored === null) return { ...DEFAULT };
  try {
    const value: unknown = JSON.parse(stored);
    if (value === null || typeof value !== "object" || !("visible" in value) || typeof value.visible !== "boolean"
      || !("height" in value) || typeof value.height !== "number" || !Number.isFinite(value.height)
      || !("selectedIndex" in value) || typeof value.selectedIndex !== "number" || !Number.isInteger(value.selectedIndex)) return { ...DEFAULT };
    return { visible: value.visible, height: Math.min(10000, Math.max(0, value.height)), selectedIndex: Math.min(7, Math.max(0, value.selectedIndex)) };
  } catch { return { ...DEFAULT }; }
}
