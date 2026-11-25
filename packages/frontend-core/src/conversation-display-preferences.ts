export type ConversationDisplayPreferences = Readonly<{
  stickyPrompt: boolean;
  navigation: boolean;
  independentFileDiffs: boolean;
  inspectorInitiallyOpen: boolean;
}>;
export type ConversationDisplayPreference = keyof ConversationDisplayPreferences;
type PreferenceStorage = Readonly<{
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}>;

export const DEFAULT_CONVERSATION_DISPLAY: ConversationDisplayPreferences = {
  stickyPrompt: false,
  navigation: false,
  independentFileDiffs: true,
  inspectorInitiallyOpen: false,
};

/** 两端共用偏好状态，存储由 Web 本地存储或桌面原生适配器注入。 */
export function createConversationDisplayPreferenceStore(storage: PreferenceStorage, key: string) {
  let snapshot: ConversationDisplayPreferences | undefined;
  const listeners = new Set<() => void>();
  const getSnapshot = (): ConversationDisplayPreferences => {
    if (snapshot !== undefined) return snapshot;
    try {
      const value: unknown = JSON.parse(storage.getItem(key) ?? "null");
      const record =
        typeof value === "object" && value !== null
          ? (value as Partial<ConversationDisplayPreferences>)
          : undefined;
      // 吸顶、目录和右栏仅显式开启，旧记录缺失字段时沿用各自默认值。
      snapshot = {
        stickyPrompt: record?.stickyPrompt === true,
        navigation: record?.navigation === true,
        inspectorInitiallyOpen: record?.inspectorInitiallyOpen === true,
        // 保留用户明确保存的关闭选择，异常字段与未配置时保持默认开启。
        independentFileDiffs: record?.independentFileDiffs !== false,
      };
    } catch {
      snapshot = DEFAULT_CONVERSATION_DISPLAY;
    }
    return snapshot;
  };
  return {
    getSnapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(preference: ConversationDisplayPreference, enabled: boolean) {
      const current = getSnapshot();
      if (current[preference] === enabled) return;
      snapshot = { ...current, [preference]: enabled };
      try {
        storage.setItem(key, JSON.stringify(snapshot));
      } catch {
        // 隐私模式或配额限制不阻断当前页面切换；可用时仍通过原有平台存储持久化。
      }
      listeners.forEach((listener) => {
        listener();
      });
    },
  };
}

export type ConversationDisplayPreferenceStore = ReturnType<
  typeof createConversationDisplayPreferenceStore
>;
