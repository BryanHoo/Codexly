import { isAgentEngine, type AcpConfigOption } from "@codexly/protocol";
import { RequestError } from "@agentclientprotocol/sdk";
import type { LocalTask, LocalCatalogStore } from "@codexly/core";
import type { AcpConnection } from "./connection.js";
import type { AcpHistory } from "./history.js";
import { AcpReplay } from "./replay.js";
import type { AcpStoredSettings } from "./settings-store.js";
import type { AcpSessionInitialization } from "./session-initialization.js";
import { applyAcpConfig } from "./configuration.js";

interface Loader {
  sessions: Map<string, string>;
  needsDefaults: Set<string>;
  replays: Map<string, AcpReplay>;
  ephemeral: boolean;
  repairHistory: boolean;
  history: AcpHistory;
  initialization?: AcpSessionInitialization;
  agent(): Promise<AcpConnection>;
  patch(patch: Partial<LocalTask>): Promise<void>;
  store: LocalCatalogStore;
  initialize?(
    connection: AcpConnection,
    sessionId: string,
    options: AcpConfigOption[],
    saved?: AcpStoredSettings,
  ): Promise<AcpConfigOption[]>;
  updated(connection: AcpConnection, sessionId: string): void;
}

function isMissingCodexSession(error: unknown, sessionId: string): boolean {
  if (!(error instanceof RequestError)) return false;
  // Codex Adapter v2.6 会把原生 JSON-RPC 错误包装成 ACP internal error 的 details。
  const detail =
    error.code === -32603 &&
    typeof error.data === "object" &&
    error.data !== null &&
    "details" in error.data
      ? error.data.details
      : error.code === -32600
        ? error.message
        : undefined;
  return (
    error.code === -32002 ||
    detail === `no rollout found for thread id ${sessionId}` ||
    detail === `thread not found: ${sessionId}` ||
    (error.code === 1001 &&
      error.message ===
        `Session ${sessionId} had no messages yet and was lost when the Codex app-server restarted. Start a new session.`)
  );
}

/** 会话加载不重试 prompt；恢复绑定与默认值使用独立私有日志，不改变旧任务或配置结构。 */
export async function loadAcpSession(
  task: LocalTask,
  explicitConfig: boolean,
  source: Loader,
): Promise<AcpConnection> {
  const connection = await source.agent();
  const journal = source.ephemeral ? undefined : source.initialization;
  const publishBinding = async (sessionId: string) => {
    if (task.sessionId === sessionId) return;
    // ACP 的 session/new 可以写原生历史。发送首个 prompt 前先登记后台身份，
    // 这样另一个宿主扫描原生目录或当前进程退出后也不会把它当作聊天。
    if (source.ephemeral) {
      if (!isAgentEngine(task.provider)) throw new Error("ACP 会话引擎无效");
      await source.store.catalog("acp.session.background", {
        engine: task.provider,
        sessionId,
      });
    }
    if (task.sessionId === null) await source.patch({ sessionId });
    else if (
      !(await source.store.catalog("acp.session.rebind", {
        id: task.id,
        expectedSessionId: task.sessionId,
        sessionId,
      }))
    )
      throw new Error("ACP 会话绑定已改变，请重新加载任务");
    task = { ...task, sessionId };
  };
  const pending = await journal?.read(task);
  const rememberConfiguration = async (sessionId: string) => {
    await journal?.saveConfiguration(
      task,
      sessionId,
      connection.readSessionState(sessionId).configOptions,
    );
  };
  if (pending) {
    await publishBinding(pending.sessionId);
    if (pending.phase === "pending") source.needsDefaults.add(task.id);
  }
  const initialize = async (sessionId: string) => {
    if (!source.needsDefaults.has(task.id) || explicitConfig) return;
    const record = await journal?.read(task);
    const initialized = await source.initialize?.(
      connection,
      sessionId,
      connection.readSessionState(sessionId).configOptions,
      record?.settings,
    );
    if (initialized) await connection.cacheSessionConfiguration(sessionId, initialized);
    await journal?.complete(task, sessionId);
    source.needsDefaults.delete(task.id);
  };
  const bound = source.sessions.get(task.id);
  const evicted = await source.history.cache.wasEvicted(task.id);
  if (bound && !source.repairHistory && !evicted) {
    // 目录回执失败时先确认已落盘的初始化意图，再发布同一绑定；禁止创建替代会话。
    if (source.needsDefaults.has(task.id)) await journal?.prepare(task, bound);
    await publishBinding(bound);
    await initialize(bound);
    return connection;
  }
  if (task.sessionId === null) {
    const session = await connection.newSession({ cwd: task.cwd, mcpServers: [] });
    source.sessions.set(task.id, session.sessionId);
    source.needsDefaults.add(task.id);
    await journal?.prepare(task, session.sessionId);
    await publishBinding(session.sessionId);
    await initialize(session.sessionId);
    await rememberConfiguration(session.sessionId);
    source.updated(connection, session.sessionId);
  } else {
    const sessionId = bound ?? task.sessionId;
    const request = { sessionId, cwd: task.cwd, mcpServers: [] };
    try {
      const complete =
        !source.repairHistory &&
        task.status === "idle" &&
        (await source.history.hasCompleteHistory(task.id));
      // 只支持 resume 的 Agent 仍可续聊。本地正文继续保留，只有显式修复才必须重放。
      if (complete || (!source.repairHistory && !evicted && !connection.canReplaySessions))
        await connection.resumeSession(request);
      else {
        const replay = new AcpReplay(source.history, task.id);
        source.replays.set(sessionId, replay);
        try {
          await connection.resumeSession(request, true);
          await replay.complete();
        } catch (error) {
          await replay.abort(error).catch(() => undefined);
          throw error;
        } finally {
          source.replays.delete(sessionId);
        }
      }
    } catch (error) {
      if (
        source.repairHistory ||
        task.provider !== "codex" ||
        !pending?.firstPromptUnsent ||
        !isMissingCodexSession(error, sessionId)
      )
        throw error;
      const replacement = await journal?.replaceUnsent(
        task,
        sessionId,
        () => source.history.hasTurns(task.id),
        async () => (await connection.newSession({ cwd: task.cwd, mcpServers: [] })).sessionId,
      );
      if (!replacement) throw error;
      source.sessions.set(task.id, replacement);
      source.needsDefaults.add(task.id);
      await publishBinding(replacement);
      await initialize(replacement);
      await rememberConfiguration(replacement);
      source.updated(connection, replacement);
      return connection;
    }
    await initialize(sessionId);
    if (pending?.configuration) {
      // 历史会话以本任务最后确认值恢复，不能被 Agent 的启动默认值或新的全局偏好覆盖。
      // 只恢复当前公布且仍合法的值；过期值留在私有记录，供选项重新出现时匹配。
      await applyAcpConfig(
        connection,
        sessionId,
        connection.readSessionState(sessionId).configOptions,
        pending.configuration,
        [],
      );
    } else await rememberConfiguration(sessionId);
    // 恢复和落盘成功后再发布暖绑定，失败重试仍需经过完整恢复流程。
    source.sessions.set(task.id, sessionId);
    source.updated(connection, sessionId);
  }
  return connection;
}
