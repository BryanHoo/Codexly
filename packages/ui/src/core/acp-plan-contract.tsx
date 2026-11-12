import type { ComponentType } from "react";
import type {
  AcpConfigPreview,
  AcpConfigPreviewRequest,
  AgentEngine,
  AgentMessageAttachment,
  ScheduledTaskSchedule,
} from "@codexly/protocol";
import type {
  AcpPlanHistory,
  AcpPlanPage,
  AcpPlanView,
  ListAcpPlans,
} from "@codexly/protocol/acp-plan-api";
import type { AcpPlanEditorPorts } from "@codexly/frontend-core/acp-plan-editor";
export interface AcpPlanUiClient extends AcpPlanEditorPorts {
  subscribeAcpPlans(listener: () => void): () => void;
  listAcpPlans(query?: ListAcpPlans, options?: { signal?: AbortSignal }): Promise<AcpPlanPage>;
  readAcpPlan(id: string, options?: { signal?: AbortSignal }): Promise<AcpPlanView>;
  readAcpPlanHistory(id: string, options?: { signal?: AbortSignal }): Promise<AcpPlanHistory>;
  deleteAcpPlan(
    id: string,
    revision: number,
    options?: { signal?: AbortSignal; idempotencyKey?: string },
  ): Promise<{ deleted: boolean }>;
  previewAcpConfig(
    projectId: string,
    engine: AgentEngine,
    input: AcpConfigPreviewRequest,
    options?: { signal?: AbortSignal },
  ): Promise<AcpConfigPreview>;
  uploadAttachment(
    projectId: string,
    input: { kind: "file" | "image"; name: string; content: Blob },
    options?: { signal?: AbortSignal },
  ): Promise<{ attachment: AgentMessageAttachment }>;
}
export type AcpPlanScheduleField = ComponentType<{
  value: ScheduledTaskSchedule;
  disabled: boolean;
  onChange: (value: ScheduledTaskSchedule | undefined) => void;
}>;
export const planLabels = {
  "zh-CN": {
    title: "定时计划",
    create: "新建计划",
    edit: "编辑计划",
    name: "计划名称",
    project: "项目",
    temporary: "普通聊天",
    agent: "智能体",
    choose: "选择智能体",
    prompt: "提示词",
    enabled: "启用计划",
    save: "保存计划",
    cancel: "取消",
    close: "关闭",
    preview: "读取智能体配置",
    loading: "正在读取…",
    retry: "重试",
    refresh: "刷新列表",
    more: "加载更多",
    empty: "暂无定时计划",
    remove: "删除计划",
    removeTitle: "删除此计划？",
    removeHint: "此计划及其运行记录将被删除，已生成的聊天任务和会话记录会保留。",
    discard: "放弃修改",
    discardTitle: "放弃未保存的修改？",
    discardHint: "未保存的草稿将丢失。",
    keep: "继续编辑",
    reload: "重新读取",
    reloadTitle: "重新读取并替换草稿？",
    attach: "添加附件",
    removeAttachment: "移除附件",
    blocked: "计划有运行中或待确认的记录，暂时无法编辑。",
    old: "原有计划与运行记录",
    schedule: "运行时间",
    invalidSchedule: "请选择有效的运行时间。",
    saved: "计划已保存",
    previewNeeded: "启用前请读取并确认智能体配置。",
    settingsSaved: "已保留此计划保存的智能体配置。",
    next: "下次运行",
    ended: "暂无下次运行",
    history: "运行记录",
    refreshHistory: "刷新记录",
    noRuns: "暂无运行记录",
    openTask: "打开任务",
    claimed: "准备启动",
    unknown: "待确认",
    started: "已启动",
    failed: "启动失败",
    definitionRevision: "计划修订",
  },
  en: {
    title: "Schedules",
    create: "New schedule",
    edit: "Edit schedule",
    name: "Schedule name",
    project: "Project",
    temporary: "Chat",
    agent: "Agent",
    choose: "Choose an agent",
    prompt: "Prompt",
    enabled: "Enable schedule",
    save: "Save schedule",
    cancel: "Cancel",
    close: "Close",
    preview: "Read agent configuration",
    loading: "Loading…",
    retry: "Retry",
    refresh: "Refresh list",
    more: "Load more",
    empty: "No schedules",
    remove: "Delete schedule",
    removeTitle: "Delete this schedule?",
    removeHint:
      "This schedule and its run history will be deleted. Created chat tasks and conversations will be kept.",
    discard: "Discard changes",
    discardTitle: "Discard unsaved changes?",
    discardHint: "The unsaved draft will be lost.",
    keep: "Keep editing",
    reload: "Reload",
    reloadTitle: "Reload and replace the draft?",
    attach: "Add attachment",
    removeAttachment: "Remove attachment",
    blocked: "An active or unresolved run prevents editing.",
    old: "Existing schedules and run history",
    schedule: "Run time",
    invalidSchedule: "Choose a valid run time.",
    saved: "Schedule saved",
    previewNeeded: "Read and confirm agent configuration before enabling.",
    settingsSaved: "The saved agent configuration is preserved.",
    next: "Next run",
    ended: "No next run",
    history: "Run history",
    refreshHistory: "Refresh history",
    noRuns: "No runs yet",
    openTask: "Open task",
    claimed: "Preparing to start",
    unknown: "Awaiting confirmation",
    started: "Started",
    failed: "Failed to start",
    definitionRevision: "Schedule revision",
  },
};
export type PlanLabels = { [K in keyof typeof planLabels.en]: string };
