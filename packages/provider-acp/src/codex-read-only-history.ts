import { readCodexReadOnlyHistory } from "@codexly/provider-codex";
import { isAbsolute } from "node:path";
import type { AgentCommand } from "./agent-executable.js";
import type { LocalTask, ReadAgentTaskInput } from "@codexly/core";

/** 外部占用的原生页使用独立游标，不写入 ACP 回放缓存，不改变会话绑定。 */
export function readAcpCodexHistory(
  task: LocalTask,
  input: ReadAgentTaskInput,
  command?: Pick<AgentCommand, "command" | "args"> & { env?: NodeJS.ProcessEnv },
) {
  if (task.provider !== "codex" || !task.sessionId) throw new Error("任务不支持 Codex 只读历史");
  const cursor = input.cursor?.startsWith("codex-readonly:")
    ? input.cursor.slice("codex-readonly:".length)
    : undefined;
  const env = command?.env;
  const binaryPath = env?.["CODEX_PATH"];
  const packageAnchor = command
    ? [...command.args, command.command].find(
        (path) => isAbsolute(path) && /\.[cm]?js$/u.test(path),
      )
    : undefined;
  return readCodexReadOnlyHistory(task.sessionId, task.cwd, cursor, input.signal, {
    ...(env ? { env } : {}),
    ...(binaryPath ? { binaryPath } : {}),
    ...(packageAnchor ? { packageAnchor } : {}),
  });
}
