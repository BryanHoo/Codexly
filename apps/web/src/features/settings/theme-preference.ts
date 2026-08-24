export type ThemePreference = "dark" | "light" | "system";

const THEME_STORAGE_KEY = "codexly.theme-preference";
const THEME_STORAGE_VERSION = 1;
const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)";

type ThemeStorageReader = Readonly<{ getItem: (key: string) => string | null }>;
type ThemeStorageWriter = Readonly<{ setItem: (key: string, value: string) => void }>;
type ThemeRoot = Readonly<{ dataset: Record<string, string | undefined> }>;

let stopWatchingSystemTheme: (() => void) | undefined;

export function readThemePreference(storage: ThemeStorageReader): ThemePreference {
  try {
    const value: unknown = JSON.parse(storage.getItem(THEME_STORAGE_KEY) ?? "null");
    if (
      typeof value === "object" &&
      value !== null &&
      "version" in value &&
      value.version === THEME_STORAGE_VERSION &&
      "theme" in value &&
      (value.theme === "dark" || value.theme === "light" || value.theme === "system")
    ) {
      return value.theme;
    }
  } catch {
    // 本地偏好损坏或不可访问时回退为系统外观，不阻断应用启动。
  }
  return "system";
}

export function saveThemePreference(theme: ThemePreference, storage: ThemeStorageWriter): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, JSON.stringify({ theme, version: THEME_STORAGE_VERSION }));
  } catch {
    // 浏览器禁用存储时仍允许当前页面切换主题。
  }
}

export function applyThemePreference(
  theme: ThemePreference,
  root: ThemeRoot,
  systemPrefersDark = false,
): void {
  root.dataset["theme"] = theme === "system" ? (systemPrefersDark ? "dark" : "light") : theme;
}

function synchronizeThemePreference(theme: ThemePreference): void {
  stopWatchingSystemTheme?.();
  stopWatchingSystemTheme = undefined;

  const mediaQuery = window.matchMedia(SYSTEM_THEME_QUERY);
  const applyCurrentTheme = () => {
    applyThemePreference(theme, document.documentElement, mediaQuery.matches);
  };
  applyCurrentTheme();

  if (theme === "system") {
    // 仅在自动模式订阅系统变化，切换到手动模式时立即移除监听。
    mediaQuery.addEventListener("change", applyCurrentTheme);
    stopWatchingSystemTheme = () => {
      mediaQuery.removeEventListener("change", applyCurrentTheme);
    };
  }
}

export function setThemePreference(theme: ThemePreference): void {
  saveThemePreference(theme, window.localStorage);
  synchronizeThemePreference(theme);
}

export function initializeThemePreference(): ThemePreference {
  const theme = readThemePreference(window.localStorage);
  synchronizeThemePreference(theme);
  return theme;
}
