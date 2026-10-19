import { randomUUID } from "node:crypto";
import type { AgentTaskScope, LocalTask } from "@codexly/core";

/** 新聊天只创建应用身份；原生会话在首次发送时绑定，临时范围不写入项目 ID。 */
export function createClaudeTask(scope: AgentTaskScope, workspacePath?: string): LocalTask {
  return {
    id: `task-${randomUUID()}`,
    provider: "claude",
    sessionId: null,
    projectId: scope.kind === "temporary" ? null : scope.id,
    cwd: workspacePath ?? scope.rootPath,
    title: "",
    updatedAt: Date.now() / 1000,
    pinned: false,
    archived: false,
    status: "notLoaded",
  };
}
