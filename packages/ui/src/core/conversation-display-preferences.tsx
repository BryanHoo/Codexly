import { useCallback, useSyncExternalStore } from "react";
import type {
  ConversationDisplayPreference,
  ConversationDisplayPreferenceStore,
} from "@codexly/frontend-core/conversation-display-preferences";
import { Button } from "./button.js";

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
    <Button
      role="switch"
      aria-label={label}
      aria-checked={enabled}
      className={`h-6 w-10 rounded-pill p-0.5 ${enabled ? "bg-brand hover:bg-brand" : "bg-control-hover"}`}
      variant="ghost"
      type="button"
      onClick={() => {
        store.set(preference, !enabled);
      }}
    >
      <span
        aria-hidden="true"
        className={`block size-5 rounded-pill bg-brand-contrast shadow-control transition-transform motion-reduce:transition-none ${enabled ? "translate-x-2" : "-translate-x-2"}`}
      />
    </Button>
  );
}
