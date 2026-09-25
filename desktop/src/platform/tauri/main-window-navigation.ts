import { listen, type UnlistenFn } from "@tauri-apps/api/event";

const MAIN_WINDOW_NAVIGATE_EVENT = "main-window://navigate";

export async function listenMainWindowNavigation(
  listener: (route: string) => void,
): Promise<UnlistenFn> {
  return listen<string>(MAIN_WINDOW_NAVIGATE_EVENT, (event) => {
    listener(event.payload);
  });
}
