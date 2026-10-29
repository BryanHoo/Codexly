import { useConversationDisplayPreference } from "@codexly/ui/core/conversation-display-preferences";
import { TimelineNavigation } from "@codexly/ui/core/timeline-navigation";
import {
  getTaskTimelineNavigationItems as getSharedNavigationItems,
  getUserMessageNavigationPreview,
  type TaskTimelineNavigationItem,
} from "@codexly/frontend-core/timeline-navigation";
export type { TaskTimelineNavigationItem } from "@codexly/frontend-core/timeline-navigation";
import type { ComponentProps } from "react";
import type { AgentItem } from "@/protocol/index.js";
import { conversationDisplayPreferences } from "../../settings/conversation-display-preferences.js";
import { useTranslation } from "../../../i18n/i18n.js";
import type { TaskStoreState } from "../../conversation/runtime/task-store.js";
import { getReviewMessageText } from "./task-timeline-running.js";

function getNavigationPreview(item: AgentItem): string | null {
  if (item.type === "review") {
    return getReviewMessageText(item);
  }
  if (item.type !== "message" || item.role !== "user") {
    return null;
  }

  return getUserMessageNavigationPreview(item);
}

export function getTaskTimelineNavigationItems(
  state: Pick<TaskStoreState, "itemKeysByTurnId" | "itemStoresByKey" | "turnIds">,
): TaskTimelineNavigationItem[] {
  return getSharedNavigationItems(state, getNavigationPreview);
}

/** 关闭时连同索引工厂一起停用，搜索定位仍由外层独立执行。 */
export function TaskTimelineNavigation(
  props: Omit<ComponentProps<typeof TimelineNavigation>, "label" | "getJumpLabel">,
) {
  const enabled = useConversationDisplayPreference(conversationDisplayPreferences, "navigation");
  const { t } = useTranslation("conversation");
  return enabled ? (
    <TimelineNavigation
      {...props}
      label={t("timeline.quickNavigation")}
      getJumpLabel={(index) => t("timeline.jumpToMessage", { index })}
    />
  ) : null;
}
