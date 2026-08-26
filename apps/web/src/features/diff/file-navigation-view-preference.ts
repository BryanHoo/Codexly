import { useCallback, useSyncExternalStore } from "react";

export type FileNavigationViewMode = "list" | "tree";
export type FileNavigationViewScope = "changes" | "review";

const STORAGE_KEY_BY_SCOPE: Readonly<Record<FileNavigationViewScope, string>> = {
  changes: "codexly:workbench:file-navigation-view:changes:v1",
  review: "codexly:workbench:file-navigation-view:review:v1",
};

type FileNavigationViewStorage = Readonly<{
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}>;

type FileNavigationViewPreference = Readonly<{
  mode: FileNavigationViewMode;
  version: 1;
}>;

const listenersByScope: Record<FileNavigationViewScope, Set<() => void>> = {
  changes: new Set(),
  review: new Set(),
};
const currentModeByScope: Record<FileNavigationViewScope, FileNavigationViewMode | undefined> = {
  changes: undefined,
  review: undefined,
};

function getFileNavigationViewStorage(): FileNavigationViewStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    // 浏览器拒绝访问本地存储时，仍允许当前页面完成视图切换。
    return undefined;
  }
}

export function readFileNavigationViewPreference(
  scope: FileNavigationViewScope,
  storage: Pick<FileNavigationViewStorage, "getItem"> | undefined,
): FileNavigationViewMode {
  if (storage === undefined) return "tree";

  try {
    const value: unknown = JSON.parse(storage.getItem(STORAGE_KEY_BY_SCOPE[scope]) ?? "null");
    return isFileNavigationViewPreference(value) ? value.mode : "tree";
  } catch {
    return "tree";
  }
}

export function writeFileNavigationViewPreference(
  scope: FileNavigationViewScope,
  mode: FileNavigationViewMode,
  storage: Pick<FileNavigationViewStorage, "setItem"> | undefined,
): void {
  if (storage === undefined) return;

  const preference: FileNavigationViewPreference = { mode, version: 1 };
  try {
    storage.setItem(STORAGE_KEY_BY_SCOPE[scope], JSON.stringify(preference));
  } catch {
    // 配额不足或隐私模式禁止写入时，不阻断当前页面切换。
  }
}

function getCurrentMode(scope: FileNavigationViewScope): FileNavigationViewMode {
  currentModeByScope[scope] ??= readFileNavigationViewPreference(
    scope,
    getFileNavigationViewStorage(),
  );
  return currentModeByScope[scope];
}

function subscribe(scope: FileNavigationViewScope, listener: () => void) {
  listenersByScope[scope].add(listener);
  return () => {
    listenersByScope[scope].delete(listener);
  };
}

function updateCurrentMode(scope: FileNavigationViewScope, mode: FileNavigationViewMode) {
  if (currentModeByScope[scope] === mode) return;

  currentModeByScope[scope] = mode;
  writeFileNavigationViewPreference(scope, mode, getFileNavigationViewStorage());
  listenersByScope[scope].forEach((listener) => {
    listener();
  });
}

export function useFileNavigationViewPreference(
  scope: FileNavigationViewScope,
): readonly [FileNavigationViewMode, (mode: FileNavigationViewMode) => void] {
  const subscribeToScope = useCallback(
    (listener: () => void) => subscribe(scope, listener),
    [scope],
  );
  const getScopeMode = useCallback(() => getCurrentMode(scope), [scope]);
  const mode = useSyncExternalStore<FileNavigationViewMode>(
    subscribeToScope,
    getScopeMode,
    () => "tree",
  );
  const setMode = useCallback(
    (nextMode: FileNavigationViewMode) => {
      updateCurrentMode(scope, nextMode);
    },
    [scope],
  );
  return [mode, setMode];
}

function isFileNavigationViewPreference(value: unknown): value is FileNavigationViewPreference {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Partial<FileNavigationViewPreference>;
  return candidate.version === 1 && (candidate.mode === "tree" || candidate.mode === "list");
}
