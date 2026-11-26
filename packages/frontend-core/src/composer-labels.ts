import { composerGitChinese, composerGitEnglish } from "./composer-git-labels.js";

/** Composer 共用文案集中维护，避免两端标签和工具栏入口名称发生偏差。 */
export const composerLabelsChinese = {
  loading: "正在加载输入框",
  ...composerGitChinese,
  moreSettings: "更多配置",
  settingsTitle: "输入配置",
  fastMode: "快速模式",
} as const;

export const composerLabelsEnglish = {
  loading: "Loading message input",
  ...composerGitEnglish,
  moreSettings: "More settings",
  settingsTitle: "Message settings",
  fastMode: "Fast mode",
} as const;
