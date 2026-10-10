import { getCurrentWindow } from "@tauri-apps/api/window";

export async function registerTextEditorCloseGuard(requestClose: (close: () => void) => void): Promise<() => void> {
  const window = getCurrentWindow();
  // 主窗口退出由原生统一确认；辅助文件/任务窗口需要保护自己的编辑草稿。
  if (window.label === "main") return () => undefined;
  let accepted = false;
  return window.onCloseRequested(event => {
    if (accepted) return;
    event.preventDefault();
    requestClose(() => {
      accepted = true;
      void window.close().catch(() => { accepted = false; });
    });
  });
}
