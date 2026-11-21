import { stripAcpGlobalInstructions } from "./global-instructions.js";
import { readAcpCodexHistory } from "./codex-read-only-history.js";
import { RequestError } from "@agentclientprotocol/sdk/experimental/v2/unstable";
import {
  localTaskMetadata,
  type LocalTask,
  type ReadAgentTaskInput,
  type AgentProviderTaskSnapshot,
} from "@codexly/core";
import type { AgentEngine } from "@codexly/protocol";
import type { AcpSessionState } from "@codexly/protocol";
import { AcpHistoryCorruptionError, type AcpHistory } from "./history.js";
import type { AcpConnection } from "./connection.js";
import type { AcpEventProjection } from "./event-projection.js";

/** 异步历史准备完成后同步读取活动投影并捕获边界，不在正文与 checkpoint 之间 await。 */
export async function readAcpTaskSnapshot(
  task: LocalTask,
  input: ReadAgentTaskInput,
  source: {
    engine: AgentEngine;
    history: AcpHistory;
    load(repairHistory?: boolean): Promise<unknown>;
    readOnlyHistory?: () => Promise<{
      turns: AgentProviderTaskSnapshot["turns"];
      cursor: string | null;
    }>;
    active(): AcpEventProjection | undefined;
    pending(): AgentProviderTaskSnapshot["pendingRequests"];
    contextUsage(): AgentProviderTaskSnapshot["contextUsage"];
    sessionState(): AcpSessionState | undefined;
  },
): Promise<AgentProviderTaskSnapshot> {
  const previous = source.active();
  const readOnlyHistory = source.readOnlyHistory ?? (() => readAcpCodexHistory(task, input));
  let external = input.cursor?.startsWith("codex-readonly:") === true;
  const load = async (repairHistory = false) => {
    try {
      await source.load(repairHistory);
    } catch (error) {
      const data =
        error instanceof RequestError
          ? (error.data as { reason?: unknown; threadId?: unknown } | null)
          : null;
      // 只接受 ACP 明确声明且匹配原生会话的占用错误，其余错误保留，不伪造空历史。
      if (
        task.provider !== "codex" ||
        !(error instanceof RequestError) ||
        error.code !== -32600 ||
        data?.reason !== "thread_active_writer" ||
        data.threadId !== task.sessionId
      )
        throw error;
      external = true;
    }
  };
  let page = external
    ? { turns: [], cursor: null }
    : await source.history.read(task.id, input.cursor).catch(async (error: unknown) => {
        // 只修复当前投影；旧游标、普通 I/O 错误和活动回合不触发整份回放。
        if (
          input.cursor ||
          source.active() ||
          !task.sessionId ||
          !(error instanceof AcpHistoryCorruptionError)
        )
          throw error;
        input.signal?.throwIfAborted();
        await load(true);
        return null;
      });
  if (page === null)
    page = external ? { turns: [], cursor: null } : await source.history.read(task.id);
  else if (
    !input.cursor &&
    !previous &&
    task.sessionId &&
    (page.turns.length === 0 || (task.provider === "codex" && input.checkWriteAccess === true))
  ) {
    await load();
    if (!external) page = await source.history.read(task.id);
  }
  if (external) {
    const nativePage = await readOnlyHistory();
    page = {
      // Codex 原生只读页也可能返回客户端附加的文本块。
      turns: nativePage.turns.map((turn) => ({
        ...turn,
        items: turn.items.flatMap((item) => {
          if (item.type !== "message" || item.role !== "user") return [item];
          const text = stripAcpGlobalInstructions(item.text);
          if (text === "") return item.attachments?.length ? [{ ...item, text }] : [];
          return text === null || text === item.text ? [item] : [{ ...item, text }];
        }),
      })),
      cursor: nativePage.cursor === null ? null : `codex-readonly:${nativePage.cursor}`,
    };
  }
  // 读旧游标期间，历史提交可能刚好移除活动投影；重新读一次才可捕获新 checkpoint。
  if (!input.cursor && previous && previous !== source.active())
    page = await source.history.read(task.id);
  input.signal?.throwIfAborted();
  const projection = source.active(),
    active = projection?.visibleSnapshot(),
    sessionState = source.sessionState();
  const turns =
    active && !input.cursor
      ? [...page.turns.filter((turn) => turn.id !== active.id), active]
      : page.turns;
  const snapshot: AgentProviderTaskSnapshot = {
    runtime: "acp",
    ...(external
      ? { writeAccess: "external" as const }
      : input.checkWriteAccess && task.provider === "codex"
        ? { writeAccess: "writable" as const }
        : {}),
    ...(sessionState ? { acpSession: sessionState } : {}),
    ...localTaskMetadata(task),
    engine: source.engine,
    status:
      active?.status === "running" ? "running" : active?.status === "failed" ? "failed" : "idle",
    turns,
    turnsNextCursor: page.cursor,
    contextUsage: source.contextUsage(),
    goal: null,
    plan: projection?.plan ?? null,
    pendingRequests: source.pending(),
  };
  input.snapshotRead?.capture(snapshot);
  return snapshot;
}

/** 未绑定的会话没有原生配置元数据，不能补造默认值。 */
export function readAcpTaskSessionState(
  connection: AcpConnection | undefined,
  sessions: ReadonlyMap<string, string>,
  id: string,
) {
  const session = sessions.get(id);
  return session ? connection?.readSessionState(session) : undefined;
}
