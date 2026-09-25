import { common as enCommon } from "./locales/en/common.js";
import { conversation as enConversation } from "./locales/en/conversation.js";
import { settings as enSettings } from "./locales/en/settings.js";
import { shortcuts as enShortcuts } from "./locales/en/shortcuts.js";
import { workbench as enWorkbench } from "./locales/en/workbench.js";
import { terminal as enTerminal } from "./locales/en/terminal.js";
import { common as zhCommon } from "./locales/zh-CN/common.js";
import { conversation as zhConversation } from "./locales/zh-CN/conversation.js";
import { settings as zhSettings } from "./locales/zh-CN/settings.js";
import { shortcuts as zhShortcuts } from "./locales/zh-CN/shortcuts.js";
import { workbench as zhWorkbench } from "./locales/zh-CN/workbench.js";
import { terminal as zhTerminal } from "./locales/zh-CN/terminal.js";

export const defaultNamespace = "common";
export const namespaces = ["common", "settings", "shortcuts", "workbench", "conversation"] as const;

export const resources = {
  en: {
    common: enCommon,
    conversation: enConversation,
    settings: enSettings,
    shortcuts: enShortcuts,
    workbench: { ...enWorkbench, terminal: enTerminal },
  },
  "zh-CN": {
    common: zhCommon,
    conversation: zhConversation,
    settings: zhSettings,
    shortcuts: zhShortcuts,
    workbench: { ...zhWorkbench, terminal: zhTerminal },
  },
} as const;
