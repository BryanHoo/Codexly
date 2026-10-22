import { sidebarFooterChinese } from "@codexly/frontend-core/sidebar-footer-labels";
import { common as zhCommon } from "./locales/zh-CN/common.js";
import { conversation as zhConversation } from "./locales/zh-CN/conversation.js";
import { settings as zhSettings } from "./locales/zh-CN/settings.js";
import { shortcuts as zhShortcuts } from "./locales/zh-CN/shortcuts.js";
import { workbench as zhWorkbench } from "./locales/zh-CN/workbench.js";
import { terminal as zhTerminal } from "./locales/zh-CN/terminal.js";

export const defaultNamespace = "common";
export const namespaces = ["common", "settings", "shortcuts", "workbench", "conversation"] as const;

export const resources = {
  "zh-CN": {
    common: zhCommon,
    conversation: zhConversation,
    settings: zhSettings,
    shortcuts: zhShortcuts,
    workbench: { ...zhWorkbench, terminal: zhTerminal, sidebarFooter: sidebarFooterChinese },
  },
} as const;
