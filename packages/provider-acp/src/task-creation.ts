import { randomUUID } from "node:crypto";
import type { AgentTaskScope, LocalTask, StartAgentTaskOptions } from "@codexly/core";
import type { AgentEngine } from "@codexly/protocol";

/** 只建立应用身份；原生 ACP 会话在首次使用时延迟创建并持久绑定。 */
export function createAcpLocalTask(
  engine: AgentEngine,
  scope: AgentTaskScope,
  options: StartAgentTaskOptions,
): LocalTask {
  if (options.engine && options.engine !== engine) throw new Error("不能切换任务引擎");
  if (options.workspacePath && !scope.runtimeWorkspaceRoots.includes(options.workspacePath))
    throw new Error("工作目录不属于当前项目");
  return {
    id: randomUUID(),
    provider: engine,
    projectId: scope.kind === "temporary" ? null : scope.id,
    cwd: options.workspacePath ?? scope.rootPath,
    sessionId: null,
    title: "",
    status: "idle",
    archived: false,
    pinned: false,
    updatedAt: Math.floor(Date.now() / 1000),
  };
}
