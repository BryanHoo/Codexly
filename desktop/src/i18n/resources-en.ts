import { common } from "./locales/en/common.js";
import { conversation } from "./locales/en/conversation.js";
import { settings } from "./locales/en/settings.js";
import { shortcuts } from "./locales/en/shortcuts.js";
import { workbench } from "./locales/en/workbench.js";
import { terminal } from "./locales/en/terminal.js";

// 各桌面窗口仅在使用英语时读取文案，不再扩大中文窗口的静态依赖闭包。
export const englishResources = {
  common, conversation, settings, shortcuts, workbench: { ...workbench, terminal },
} as const;
