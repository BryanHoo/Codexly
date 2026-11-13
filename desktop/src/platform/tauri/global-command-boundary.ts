// 这些 DTO 或文件操作仍绑定旧厂商运行时；ACP 界面改用已协商的专用端口。
const legacyGlobalCommands = new Set([
  "read_thread_memory",
  "compress_history",
  "get_global_instructions",
  "save_global_instructions",
  "get_memory_settings",
  "update_memory_settings",
  "reset_memories",
  "list_models",
  "get_provider_connection",
  "start_official_provider_login",
  "cancel_provider_login",
  "configure_custom_provider",
  "logout_provider",
  "get_global_settings",
  "update_global_settings",
  "get_project_defaults",
  "update_project_defaults",
  "list_skills",
  "list_installed_skills",
  "list_configured_mcp_servers",
  "open_skill_directory",
  "set_skill_enabled",
  "set_mcp_server_enabled",
  "reconcile_official_plugins",
  "list_official_plugins",
  "get_official_plugin",
  "install_official_plugin",
  "uninstall_official_plugin",
  "list_mcp_servers",
  "retry_mcp_servers",
  "claude_engine_request",
  "upload_feedback",
]);

export function requiresLegacyGlobalRuntime(command: string): boolean {
  return legacyGlobalCommands.has(command);
}

/** 仅客户端诊断使用，不扩展旧版严格读取的公开错误枚举。 */
export class AcpLegacyGlobalCommandError extends Error {
  readonly code = "ACP_LEGACY_GLOBAL_COMMAND_REJECTED";
  readonly command: string;
  constructor(command: string) {
    super("当前运行时不支持此操作");
    this.name = "AcpLegacyGlobalCommandError";
    this.command = command;
  }
}
