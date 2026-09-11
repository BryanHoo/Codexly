import { i18n } from "./i18n.js";

// 文案随设置页面加载，不增加工作台初始加载体积。
i18n.addResourceBundle(
  "zh-CN",
  "settings",
  {
    personalization: {
      instructions: "Codex 说明",
      commitTitle: "提交消息",
      commitDescription: "设置 Git 提交消息的生成偏好，修改后自动保存。",
      commitModel: "生成模型",
      commitModelDescription: "选择用于生成提交消息的模型。",
      commitRules: "生成规则",
      commitRulesDescription: "指定语言、格式和内容要求，仅用于生成提交消息。",
      commitPlaceholder: "例如：使用简体中文，遵循 Conventional Commits，简要说明变更目的。",
      fileLocation: "文件位置：{{path}}",
      description:
        "为在此电脑上运行的任务提供说明和上下文。项目中的说明也会适用。保存后对新会话生效。",
      save: "保存",
      saving: "正在保存",
      saved: "已保存",
      reload: "重新读取",
      loadError: "读取失败，请重试。",
      saveError: "保存失败，草稿已保留。",
      conflict: "文件已在其他位置修改。请复制保留草稿，再重新读取后编辑。",
      override: "检测到 AGENTS.override.md，Codex 会优先使用其中的说明。",
      memories: "记忆",
      memoryDescription: "设置 Codex 如何收集、保留和使用本地记忆。设置应用于后续会话。",
      enabled: "启用本地记忆",
      enabledDescription: "根据此电脑上的聊天生成记忆，并用于后续聊天。",
      external: "允许基于工具辅助聊天生成本地记忆",
      externalDescription: "允许从使用过 MCP 工具或网页搜索的聊天生成记忆。",
      remove: "删除本地记忆",
      removeDescription: "清除本地记忆文件和记忆处理数据，保留聊天记录。",
      confirm: "确认删除",
      confirmDescription: "此操作无法撤销。启用记忆时，后续会话仍可能生成新记忆。",
      cancel: "取消",
      deleting: "正在删除",
      deleted: "本地记忆已删除",
      memoryError: "记忆操作失败，请重试。",
    },
  },
  true,
);
i18n.addResourceBundle(
  "en",
  "settings",
  {
    personalization: {
      instructions: "Codex instructions",
      commitTitle: "Commit messages",
      commitDescription:
        "Set preferences for generated Git commit messages. Changes are saved automatically.",
      commitModel: "Generation model",
      commitModelDescription: "Choose the model used to generate commit messages.",
      commitRules: "Generation rules",
      commitRulesDescription:
        "Specify language, format, and content requirements for commit messages only.",
      commitPlaceholder:
        "For example: follow Conventional Commits and briefly explain the purpose of the changes.",
      fileLocation: "File location: {{path}}",
      description:
        "Provide instructions and context for tasks on this computer. Project instructions also apply. Saved changes apply to new sessions.",
      save: "Save",
      saving: "Saving",
      saved: "Saved",
      reload: "Reload",
      loadError: "Could not load. Please retry.",
      saveError: "Could not save. Your draft is preserved.",
      conflict: "The file changed elsewhere. Copy your draft before reloading and editing again.",
      override: "AGENTS.override.md is present. Codex prioritizes its instructions.",
      memories: "Memory",
      memoryDescription:
        "Choose how Codex collects, retains, and uses local memory. Changes apply to subsequent sessions.",
      enabled: "Enable local memory",
      enabledDescription: "Generate memory from chats on this computer and use it in future chats.",
      external: "Allow memory from tool-assisted chats",
      externalDescription: "Allow memory from chats that used MCP tools or web search.",
      remove: "Delete local memory",
      removeDescription: "Clear local memory files and processing data while keeping chat history.",
      confirm: "Confirm deletion",
      confirmDescription:
        "This cannot be undone. Future sessions may generate new memory while memory is enabled.",
      cancel: "Cancel",
      deleting: "Deleting",
      deleted: "Local memory deleted",
      memoryError: "Memory operation failed. Please retry.",
    },
  },
  true,
);
