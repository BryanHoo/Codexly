import { common } from "./locales/en/common.js";
import { conversation } from "./locales/en/conversation.js";
import { settings } from "./locales/en/settings.js";
import { workbench } from "./locales/en/workbench.js";

// 英语基础文案独立成块，中文启动不请求；功能页的增量文案仍沿现有按需入口加载。
export const englishResources = { common, conversation, settings, workbench } as const;
