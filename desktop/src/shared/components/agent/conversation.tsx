import { useConversationDisplayPreference } from "@codexly/ui/core/conversation-display-preferences";
import { conversationDisplayPreferences } from "../../../features/settings/conversation-display-preferences.js";
import { Conversation as SharedConversation, ConversationList as SharedConversationList, ConversationScrollButton as SharedScrollButton, type ConversationListProps as SharedListProps } from "@codexly/ui/agent/conversation";
import type { ComponentProps } from "react";
import { useTranslation } from "../../../i18n/i18n.js";
export { ConversationContent, ConversationItems } from "@codexly/ui/agent/conversation";
export type ConversationListProps<T> = Omit<SharedListProps<T>, "scrollLabel">;
export function ConversationList<T>(props: ConversationListProps<T>) {
  const { t } = useTranslation("conversation");
  const stickyPromptEnabled = useConversationDisplayPreference(conversationDisplayPreferences, "stickyPrompt");
  return <SharedConversationList stickyPromptEnabled={stickyPromptEnabled} {...props} scrollLabel={t("agentComponents.scrollToBottom")} />;
}
export function ConversationScrollButton(props: Omit<ComponentProps<typeof SharedScrollButton>, "label">) {
  const { t } = useTranslation("conversation");
  return <SharedScrollButton {...props} label={t("agentComponents.scrollToBottom")} />;
}

export function Conversation(props: ComponentProps<typeof SharedConversation>) { const { t } = useTranslation("conversation"); const stickyPromptEnabled = useConversationDisplayPreference(conversationDisplayPreferences, "stickyPrompt");
  return <SharedConversation stickyPromptEnabled={stickyPromptEnabled} {...props} scrollLabel={t("agentComponents.scrollToBottom")} />; }
