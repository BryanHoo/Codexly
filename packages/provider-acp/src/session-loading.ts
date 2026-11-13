import type { SessionConfigOption } from "@agentclientprotocol/sdk/unstable";
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
  initialize?(
    connection: AcpConnection,
    sessionId: string,
    options: SessionConfigOption[],
    saved?: AcpStoredSettings,
  ): Promise<SessionConfigOption[]>;
  updated(connection: AcpConnection, sessionId: string): void;
}

/** 会话加载不重试 prompt；恢复绑定与默认值使用独立私有日志，不改变旧任务或配置结构。 */
export async function loadAcpSession(
  task: LocalTask,
  explicitConfig: boolean,
  source: Loader,
): Promise<AcpConnection> {
  const connection = await source.agent();
  const journal = source.ephemeral ? undefined : source.initialization;
  const pending = await journal?.read(task);
  if (pending) {
    if (!task.sessionId) {
      await source.patch({ sessionId: pending.sessionId });
      task = { ...task, sessionId: pending.sessionId };
    }
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
    if (task.sessionId !== bound) await source.patch({ sessionId: bound });
    await initialize(bound);
    return connection;
  }
  if (source.sessions.size >= 64) throw new Error("ACP 活跃会话达到容量限制");
  if (source.ephemeral && !connection.initialization.agentCapabilities?.sessionCapabilities?.close)
    throw new Error("ACP agent 不支持辅助会话关闭");
  if (task.sessionId === null) {
    const session = await connection.newSession({ cwd: task.cwd, mcpServers: [] });
    source.sessions.set(task.id, session.sessionId);
    source.needsDefaults.add(task.id);
    await journal?.prepare(task, session.sessionId);
    await source.patch({ sessionId: session.sessionId });
    await initialize(session.sessionId);
    source.updated(connection, session.sessionId);
  } else {
    const replay = new AcpReplay(source.history, task.id);
    let replayed = false;
    source.replays.set(task.sessionId, replay);
    try {
      await connection.loadSession({ sessionId: task.sessionId, cwd: task.cwd, mcpServers: [] });
      await replay.complete();
      replayed = true;
      source.sessions.set(task.id, task.sessionId);
      await initialize(task.sessionId);
      source.updated(connection, task.sessionId);
    } catch (error) {
      if (!replayed) await replay.abort(error);
      throw error;
    } finally {
      source.replays.delete(task.sessionId);
    }
  }
  return connection;
}
