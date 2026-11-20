import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import {
  AgentTurnNotSubmittedError,
  localTaskMetadata,
  type LocalCatalogStore,
  type AgentTaskScope,
  type LocalTask,
  type StartAgentTaskOptions,
} from "@codexly/core";
import type { AgentEngine } from "@codexly/protocol";

const execute = promisify(execFile);
async function authorizedWorkspace(scope: AgentTaskScope, requested: string): Promise<boolean> {
  if (scope.runtimeWorkspaceRoots.includes(requested)) return true;
  const canonical = await realpath(requested);
  for (const root of scope.runtimeWorkspaceRoots) {
    if ((await realpath(root)) === canonical) return true;
    if (scope.kind !== "project") continue;
    // 只承认 Git 登记的完整工作树路径；仓库子目录和其他仓库不能扩大授权范围。
    const { stdout } = await execute("git", ["-C", root, "worktree", "list", "--porcelain", "-z"], {
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")),
      ),
    }).catch(() => ({ stdout: "" }));
    for (const field of stdout.split("\0")) {
      if (
        field.startsWith("worktree ") &&
        (await realpath(field.slice(9)).catch(() => undefined)) === canonical
      )
        return true;
    }
  }
  return false;
}

/** 只建立应用身份；原生 ACP 会话在首次使用时延迟创建并持久绑定。 */
export async function createAcpLocalTask(
  engine: AgentEngine,
  scope: AgentTaskScope,
  options: StartAgentTaskOptions,
): Promise<LocalTask> {
  if (options.engine && options.engine !== engine) throw new Error("不能切换任务引擎");
  if (options.workspacePath && !(await authorizedWorkspace(scope, options.workspacePath)))
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

/** 用户任务先持久化，临时辅助任务仅保存在有界内存中。 */
export async function startAcpLocalTask(
  engine: AgentEngine,
  scope: AgentTaskScope,
  options: StartAgentTaskOptions,
  store: LocalCatalogStore,
  ephemeral: Map<string, LocalTask>,
) {
  // 只将持久化之前的校验失败声明为未创建；task.put 失败可能已写盘，仍保留未知保护。
  let task: LocalTask;
  try {
    if (options.ephemeral && ephemeral.size >= 32) throw new Error("ACP 辅助会话达到容量限制");
    task = await createAcpLocalTask(engine, scope, options);
  } catch (error) {
    throw new AgentTurnNotSubmittedError(
      error instanceof Error ? error.message : "ACP 任务未创建",
      { cause: error },
    );
  }
  if (options.ephemeral) ephemeral.set(task.id, task);
  else await store.catalog("task.put", task);
  return localTaskMetadata(task);
}
