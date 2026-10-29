import { createConversationDisplayPreferenceStore } from "@codexly/frontend-core/conversation-display-preferences";

export const conversationDisplayPreferences = createConversationDisplayPreferenceStore(
  {
    getItem: (key) => (typeof window === "undefined" ? null : window.localStorage.getItem(key)),
    setItem: (key, value) => {
      window.localStorage.setItem(key, value);
    },
  },
  "codexly:conversation-display:v1",
);
