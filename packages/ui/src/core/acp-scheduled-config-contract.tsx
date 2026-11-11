import type {
  AcpConfigPreview,
  AcpConfigPreviewRequest,
  AcpScheduledConfigView,
  AgentEngine,
  SetAcpScheduledConfig,
} from "@codexly/protocol";

export interface AcpScheduledConfigClient {
  getAcpScheduledConfig(
    id: string,
    options?: { signal?: AbortSignal },
  ): Promise<AcpScheduledConfigView>;
  setAcpScheduledConfig(
    id: string,
    input: SetAcpScheduledConfig,
    options?: { idempotencyKey?: string },
  ): Promise<AcpScheduledConfigView>;
  previewAcpConfig(
    projectId: string,
    engine: AgentEngine,
    input: AcpConfigPreviewRequest,
    options?: { signal?: AbortSignal },
  ): Promise<AcpConfigPreview>;
}
export const scheduledConfigLabels = {
  "zh-CN": {
    configure: "配置智能体",
    agent: "智能体",
    choose: "选择智能体",
    save: "保存配置",
    cancel: "取消",
    preview: "正在读取智能体配置…",
    retry: "重试",
    run: "立即运行",
    enable: "启用计划",
    disable: "暂停计划",
    history: "运行记录",
    open: "查看任务",
    next: "下次运行",
    none: "暂无运行记录",
    running: "运行中",
    unknown: "待确认",
    cleanup_pending: "收尾中",
    started: "已启动",
    skipped: "已跳过",
    failed: "失败",
    empty: "智能体未提供可配置选项。",
    confirm: "确认使用以上智能体配置运行此计划",
    first: "请选择并确认此计划的智能体配置。原有计划内容和运行记录将保留。",
    blocked: "计划正在运行，或有待确认的运行结果。暂时无法修改配置或再次运行。",
    discard: "放弃修改",
    discardTitle: "放弃未保存的配置？",
    keep: "继续编辑",
    discardDescription: "未保存的配置将丢失。",
    unavailable: "暂时无法读取计划配置。",
  },
  en: {
    configure: "Configure agent",
    agent: "Agent",
    choose: "Choose an agent",
    save: "Save configuration",
    cancel: "Cancel",
    preview: "Loading agent configuration…",
    retry: "Retry",
    run: "Run now",
    enable: "Enable schedule",
    disable: "Pause schedule",
    history: "Run history",
    open: "View task",
    next: "Next run",
    none: "No runs yet",
    running: "Running",
    unknown: "Needs confirmation",
    cleanup_pending: "Finalizing",
    started: "Started",
    skipped: "Skipped",
    failed: "Failed",
    empty: "The agent did not provide configurable options.",
    confirm: "Confirm running this schedule with the agent configuration above",
    first:
      "Choose and confirm the agent configuration. Existing content and run history will be retained.",
    blocked:
      "A run is active or its outcome needs confirmation. Configuration and further runs are unavailable.",
    discard: "Discard changes",
    discardTitle: "Discard unsaved configuration?",
    keep: "Keep editing",
    discardDescription: "Unsaved configuration will be lost.",
    unavailable: "Schedule configuration is unavailable.",
  },
};
export type ScheduledConfigLabels = { [K in keyof typeof scheduledConfigLabels.en]: string };
