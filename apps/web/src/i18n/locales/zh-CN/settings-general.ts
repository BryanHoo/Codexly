export const generalSettings = {
  permissions: "权限",
  preferences: "通用",
  editor: "编辑器",
  approvalDescription: "选择任务请求额外权限时的审批方式。",
  sandboxDescription: "限制任务对文件的访问范围；完全访问允许操作工作区之外的文件。",
  openAppDescription: "打开项目文件和文件夹时优先使用的应用。",
  languageDescription: "Codexly 的界面语言。",
  themeDescription: "选择浅色、深色或跟随系统外观。",
  followUpDescription: "任务运行时，将新消息加入队列，或立即引导当前任务。",
  taskNotifications: "任务通知",
  notificationsDescription: "任务完成、失败或需要处理时发送系统通知。",
} as const;

export const agentSettings = {
  defaults: "智能体默认设置",
  model: "模型默认设置",
  webSearch: {
    label: "网页搜索",
    description: "选择新任务搜索网页的方式。",
    disabled: "关闭",
    cached: "缓存",
    live: "实时",
  },
  modelVerbosity: {
    label: "输出详细程度",
    description: "选择新任务回复包含细节的详细程度，支持情况因模型而异。",
    default: "模型默认",
    low: "简洁",
    medium: "适中",
    high: "详细",
  },
} as const;
