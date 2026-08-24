import { common as enCommon } from "./locales/en/common.js";
import { conversation as enConversation } from "./locales/en/conversation.js";
import { settings as enSettings } from "./locales/en/settings.js";
import { workbench as enWorkbench } from "./locales/en/workbench.js";
import { common as zhCommon } from "./locales/zh-CN/common.js";
import { conversation as zhConversation } from "./locales/zh-CN/conversation.js";
import { settings as zhSettings } from "./locales/zh-CN/settings.js";
import { workbench as zhWorkbench } from "./locales/zh-CN/workbench.js";

export const defaultNamespace = "common";
export const namespaces = ["common", "settings", "workbench", "conversation"] as const;

export const resources = {
  en: {
    common: enCommon,
    conversation: enConversation,
    settings: enSettings,
    workbench: enWorkbench,
  },
  "zh-CN": {
    common: zhCommon,
    conversation: zhConversation,
    settings: zhSettings,
    workbench: zhWorkbench,
  },
} as const;
