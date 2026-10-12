import { common as zhCommon } from "./locales/zh-CN/common.js";
import { conversation as zhConversation } from "./locales/zh-CN/conversation.js";
import { settings as zhSettings } from "./locales/zh-CN/settings.js";
import { workbench as zhWorkbench } from "./locales/zh-CN/workbench.js";

export const defaultNamespace = "common";
export const namespaces = ["common", "settings", "workbench", "conversation"] as const;

export const resources = {
  "zh-CN": {
    common: zhCommon,
    conversation: zhConversation,
    settings: zhSettings,
    workbench: zhWorkbench,
  },
} as const;
