import { appPreferenceStorage } from "../../platform/tauri/app-storage.js";
import { terminalPreferenceKey, type TerminalPreferences } from "./terminal-preferences.js";

export async function saveTerminalPreferences(projectId: string, value: TerminalPreferences): Promise<void> {
  // 显式构造持久化对象，禁止把运行时 scope、进程或输出意外带进偏好存储。
  appPreferenceStorage.setItem(await terminalPreferenceKey(projectId), JSON.stringify({ visible: value.visible, height: value.height, selectedIndex: value.selectedIndex }));
}
