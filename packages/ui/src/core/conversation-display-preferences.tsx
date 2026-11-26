import { useCallback, useSyncExternalStore } from "react";
import type {
  ConversationDisplayPreference,
  ConversationDisplayPreferenceStore,
} from "@codexly/frontend-core/conversation-display-preferences";
import { Switch } from "./switch.js";

export function useConversationDisplayPreference(
  store: ConversationDisplayPreferenceStore,
  preference: ConversationDisplayPreference,
) {
  // 每个消费者只订阅自己的布尔值，切换目录不会使所有消息组件重新渲染。
  const getSnapshot = useCallback(() => store.getSnapshot()[preference], [store, preference]);
  return useSyncExternalStore(store.subscribe, getSnapshot, () => false);
}

export function ConversationDisplaySwitch({
  store,
  preference,
  label,
}: Readonly<{
  store: ConversationDisplayPreferenceStore;
  preference: ConversationDisplayPreference;
  label: string;
}>) {
  const enabled = useConversationDisplayPreference(store, preference);
  return (
    <Switch
      aria-label={label}
      checked={enabled}
      onCheckedChange={(value) => {
        store.set(preference, value);
      }}
    />
  );
}
