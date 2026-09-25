import { listenMainWindowNavigation } from "../platform/tauri/main-window-navigation.js";

type NavigateMainWindow = (href: string) => unknown;

export async function installMainWindowNavigation(
  navigate: NavigateMainWindow,
): Promise<() => void> {
  return listenMainWindowNavigation((route) => {
    // 原生层只传应用内相对路由，统一交给现有 Router 更新而不重载 WebView。
    navigate(`/${route.replace(/^\/+/, "")}`);
  });
}
