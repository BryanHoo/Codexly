// 管理型客户端由设置页控制配置与身份，不提供终端配置界面或重新绑定会话的命令。
const managedCommands = new Set([
  "login",
  "logout",
  "resume",
  "clear",
  "fork",
  "config",
  "model",
  "effort",
  "fast",
  "mcp",
  "agents",
  "auto-mode-setup",
  "autocompact",
  "color",
  "output-style",
  "focus",
  "heapdump",
  "reload-plugins",
  "reload-skills",
  "rename",
  "goal",
  "list-agents",
  "team-onboarding",
  "__remote-workflow",
  "workflow-launch-exec",
  "update-config",
  "fewer-permission-prompts",
]);
export function isSupportedClaudeCommand(name: string): boolean {
  return !managedCommands.has(name);
}
export function isManagedClaudeCommand(prompt: string): boolean {
  const command = /^\s*\/([^\s]+)/u.exec(prompt)?.[1];
  return command !== undefined && !isSupportedClaudeCommand(command);
}
