export type ConversationDisplayPreferences = Readonly<{
  stickyPrompt: boolean;
  navigation: boolean;
}>;
export type ConversationDisplayPreference = keyof ConversationDisplayPreferences;
type PreferenceStorage = Readonly<{
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}>;

export const DEFAULT_CONVERSATION_DISPLAY: ConversationDisplayPreferences = {
  stickyPrompt: false,
  navigation: false,
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
      // 仅显式布尔值 true 才启用；旧安装、缺失字段和损坏数据统一保持关闭。
      snapshot = {
        stickyPrompt: record?.stickyPrompt === true,
        navigation: record?.navigation === true,
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
