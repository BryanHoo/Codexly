import { RequestError, type SessionConfigOption } from "@agentclientprotocol/sdk/unstable";
import type { LocalTask } from "@codexly/core";
import type { AcpConnection } from "./connection.js";
import type { AcpHistory } from "./history.js";
import { AcpReplay } from "./replay.js";
import type { AcpStoredSettings } from "./settings-store.js";
import type { AcpSessionInitialization } from "./session-initialization.js";

interface Loader {
  sessions: Map<string, string>;
  needsDefaults: Set<string>;
  replays: Map<string, AcpReplay>;
  ephemeral: boolean;
  history: AcpHistory;
  initialization?: AcpSessionInitialization;
  agent(): Promise<AcpConnection>;
  patch(patch: Partial<LocalTask>): Promise<void>;
  rebind(expectedSessionId: string, sessionId: string): Promise<void>;
  initialize?(
    connection: AcpConnection,
    sessionId: string,
    options: SessionConfigOption[],
    saved?: AcpStoredSettings,
  ): Promise<SessionConfigOption[]>;
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
    if (task.sessionId === null) await source.patch({ sessionId });
    else await source.rebind(task.sessionId, sessionId);
    task = { ...task, sessionId };
  };
  const pending = await journal?.read(task);
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
  if (bound) {
    // 目录回执失败时先确认已落盘的初始化意图，再发布同一绑定；禁止创建替代会话。
    if (source.needsDefaults.has(task.id)) await journal?.prepare(task, bound);
    await publishBinding(bound);
    await initialize(bound);
    return connection;
  }
  if (source.ephemeral && !connection.initialization.agentCapabilities?.sessionCapabilities?.close)
    throw new Error("ACP agent 不支持辅助会话关闭");
  if (task.sessionId === null) {
    const session = await connection.newSession({ cwd: task.cwd, mcpServers: [] });
    source.sessions.set(task.id, session.sessionId);
    source.needsDefaults.add(task.id);
    await journal?.prepare(task, session.sessionId);
    await publishBinding(session.sessionId);
    await initialize(session.sessionId);
    source.updated(connection, session.sessionId);
  } else {
    const sessionId = task.sessionId;
    const capabilities = connection.initialization.agentCapabilities;
    const canResume = Boolean(capabilities?.sessionCapabilities?.resume);
    const request = { sessionId, cwd: task.cwd, mcpServers: [] };
    try {
      const complete =
        canResume && task.status === "idle" && (await source.history.hasCompleteHistory(task.id));
      if (canResume && (complete || !capabilities?.loadSession)) {
        // ACP v1 的 resume 只恢复模型上下文。仅支持 resume 时允许续聊，但保留本地历史缺口。
        if (!complete) await source.history.markIncomplete(task.id);
        await connection.resumeSession(request);
      } else if (capabilities?.loadSession) {
        const replay = new AcpReplay(source.history, task.id);
        source.replays.set(sessionId, replay);
        try {
          await connection.loadSession(request);
          await replay.complete();
        } catch (error) {
          await replay.abort(error).catch(() => undefined);
          throw error;
        } finally {
          source.replays.delete(sessionId);
        }
      } else {
        throw new Error("此 ACP agent 不支持 session/load 或 session/resume，无法恢复原会话");
      }
    } catch (error) {
      if (
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
      source.updated(connection, replacement);
      return connection;
    }
    source.sessions.set(task.id, sessionId);
    await initialize(sessionId);
    source.updated(connection, sessionId);
  }
  return connection;
}
