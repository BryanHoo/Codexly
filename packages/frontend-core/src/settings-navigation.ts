/** 设置归属由两端共用；平台只过滤自身不支持的入口，不挂载面板来建立搜索索引。 */
export const settingsSectionGroups = [
  { id: "personal", sections: ["appearance", "prompts", "pets", "git"] },
  { id: "agents", sections: ["acp"] },
  { id: "app", sections: ["network", "access", "about"] },
] as const;
/** 旧入口仅用于兼容已有跳转，实际导航统一落到 ACP。 */
export type SettingsSectionId =
  | (typeof settingsSectionGroups)[number]["sections"][number]
  | "provider"
  | "agent"
  | "personalization"
  | "claude-provider"
  | "claude-agent"
  | "claude-personalization";

export function resolveSettingsSection(section: SettingsSectionId): SettingsSectionId {
  return settingsSectionEngine(section) ? "acp" : section;
}

export type ClaudeSettingsSectionId = Extract<SettingsSectionId, `claude-${string}`>;

/** 两端路由使用同一分类判定，Claude 子菜单之间复用组件实例以保留草稿。 */
export function isClaudeSettingsSection(
  section: SettingsSectionId,
): section is ClaudeSettingsSectionId {
  return section.startsWith("claude-");
}

export const settingsSectionSearchKeys: Record<SettingsSectionId, readonly string[]> = {
  acp: [
    "sectionKeywords.acp",
    "fields.fastMode",
    "fields.model",
    "fields.reasoningEffort",
    "fields.approvalPolicy",
    "fields.sandbox",
    "agent.webSearch.label",
    "agent.modelVerbosity.label",
  ],
  "claude-provider": [],
  "claude-agent": [],
  "claude-personalization": [],
  network: [],
  access: ["access.logout"],
  prompts: ["sections.prompts", "sectionKeywords.prompts"],
  git: [
    "fields.defaultAgent",
    "fields.defaultModel",
    "fields.commitMessagePrompt",
    "fields.taskTitlePrompt",
  ],
  personalization: [
    "personalization.instructions",
    "personalization.memories",
    "personalization.enabled",
    "personalization.external",
  ],
  appearance: [
    "appearance.colorMode",
    "appearance.language",
    "appearance.notifications",
    "fields.defaultOpenWith",
    "fields.followUpMessages",
    "general.editor",
    "general.taskNotifications",
    "background.label",
    "background.bing",
    "background.custom",
    "background.blurLabel",
    "background.overlayOpacityLabel",
  ],
  pets: ["pets.enabled", "pets.selectionLabel"],
  provider: [
    "provider.apiKey",
    "provider.baseUrl",
    "provider.models",
    "provider.official",
    "provider.custom",
  ],
  agent: [
    "fields.fastMode",
    "fields.model",
    "fields.reasoningEffort",
    "fields.approvalPolicy",
    "fields.sandbox",
    "agent.webSearch.label",
    "agent.modelVerbosity.label",
  ],
  about: ["about.codexVersion", "about.claudeVersion", "about.update", "about.releaseNotes"],
};

/** 一个引擎的连接、模型和个性化设置共用启用边界，不能从其他子菜单绕过准备。 */
export function settingsSectionEngine(section: SettingsSectionId): "codex" | "claude" | undefined {
  if (isClaudeSettingsSection(section)) return "claude";
  if (section === "provider" || section === "agent" || section === "personalization")
    return "codex";
  return undefined;
}
