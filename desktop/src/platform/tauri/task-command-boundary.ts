// 这些命令仍消费旧任务/设置 DTO；ACP 会话必须使用已迁移的专用端口。
const legacyTaskCommands = new Set([
  "start_task",
  "start_turn",
  "submit_prompt",
  "submit_review",
  "steer_turn",
  "stop_task_session",
  "get_task_settings",
  "update_task_settings",
  "update_task_goal",
  "clear_task_goal",
  "compact_task",
  "fork_task",
  "list_background_terminals",
  "terminate_background_terminal",
  "list_queued_submissions",
  "add_queued_submission",
  "delete_queued_submission",
  "move_queued_submission",
  "start_queued_submission",
  "read_task",
  "retain_task_subscription",
  "release_task_subscription",
  "pin_task",
  "rename_task",
  "archive_task",
  "unarchive_task",
  "delete_task",
  "interrupt_turn",
]);

export function requiresLegacyTaskRuntime(
  command: string,
  args?: Record<string, unknown>,
): boolean {
  // 审批归属以请求自身标记为准；旧/ACP 界面共存时不能误挡共享 ACP 权限代理。
  return (
    legacyTaskCommands.has(command) ||
    (command === "resolve_pending_request" && args?.["acp"] !== true)
  );
}

/** 本地拒绝不扩展旧协议枚举；命令名仅供诊断，产品提示不暴露传输细节。 */
export class AcpLegacyTaskCommandError extends Error {
  readonly code = "ACP_LEGACY_TASK_COMMAND_REJECTED";
  readonly command: string;
  constructor(command: string) {
    super("当前会话不支持此操作");
    this.name = "AcpLegacyTaskCommandError";
    this.command = command;
  }
}
