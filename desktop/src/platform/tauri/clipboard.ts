import { invoke } from "@tauri-apps/api/core";

/** 使用原生剪贴板绕过 WebView 的用户手势限制，仅在明确复制时发送一次文本。 */
export function copyText(text: string): Promise<void> {
  return invoke<void>("plugin:clipboard-manager|write_text", { text });
}
