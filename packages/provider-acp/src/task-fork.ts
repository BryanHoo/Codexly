import { createHash, randomUUID } from "node:crypto";
import { RequestError } from "@agentclientprotocol/sdk";
import { localTaskMetadata, type LocalCatalogStore, type LocalTask } from "@codexly/core";
import type { HistoricalTaskAttachments } from "@codexly/core/task-attachments";
import type { AgentTurn } from "@codexly/protocol";
import type { AcpConnection } from "./connection.js";
import type { AcpHistory } from "./history.js";
import type { AcpHistoryEntry } from "./replay-anchor.js";

export interface ForkPoint {
  lastTurnId?: string | undefined;
  lastItemId?: string | undefined;
  idempotencyKey?: string | undefined;
}

export interface ForkDependencies {
  store: LocalCatalogStore;
  history: AcpHistory;
  attachments: HistoricalTaskAttachments;
  active(): AgentTurn | undefined;
  recover(): Promise<AcpConnection>;
  connect(): Promise<AcpConnection>;
  bind(task: LocalTask, connection: AcpConnection): void;
}

function forkId(source: string, point: ForkPoint) {
  if (!point.idempotencyKey) return randomUUID();
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        "acp-task-fork",
        source,
        point.idempotencyKey,
        point.lastTurnId,
        point.lastItemId,
      ]),
    )
    .digest("hex");
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

function cutTurn(turn: AgentTurn, itemId: string): AgentTurn {
  const index = turn.items.findIndex((item) => item.id === itemId && item.type === "message");
  if (index < 0) throw new Error("找不到要分支的聊天消息");
  if (index === turn.items.length - 1 && turn.status !== "running") return turn;
  // 回合的后续工具和消息不属于分支。只保留选定边界以前的条目与时间信息。
  const { stopReason: _stop, itemTimings, ...rest } = turn;
  const items = turn.items.slice(0, index + 1);
  return {
    ...rest,
    items,
    status: "completed",
    error: null,
    completedAt: turn.completedAt ?? new Date().toISOString(),
    ...(itemTimings && {
      itemTimings: Object.fromEntries(
        items.flatMap(({ id }) => {
          const timing = itemTimings[id];
          return timing === undefined ? [] : [[id, timing]];
        }),
      ),
    }),
  };
}

function cursorAfter(connection: AcpConnection, session: string, selected: AcpHistoryEntry) {
  const last = selected.turn.items.at(-1);
  if (last?.type !== "message") return undefined;
  const prefix = `acp:message:${last.role === "user" ? "user" : "assistant"}:`;
  const projectedId = last.id.startsWith(prefix) ? last.id.slice(prefix.length) : undefined;
  const firstUser = selected.turn.items.find(
    (item) => item.type === "message" && item.role === "user",
  );
  const id = last === firstUser && selected.acpMessageId ? selected.acpMessageId : projectedId;
  return id
    ? connection.forkCursors.after(
        session,
        last.role === "user" ? "user_message" : "agent_message",
        id,
      )
    : undefined;
}

async function copyAttachments(
  source: string,
  target: string,
  turn: AgentTurn,
  { attachments, history }: ForkDependencies,
) {
  for (const item of turn.items) {
    if (item.type !== "message") continue;
    for (const { id } of item.attachments ?? []) {
      try {
        await attachments.forkAttachment(source, target, id);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await history.cache
          .content(source)
          .forkAttachment(source, target, id, history.cache.content(target));
      }
    }
  }
}

export async function forkAcpTask(source: LocalTask, point: ForkPoint, deps: ForkDependencies) {
  const { store, history, attachments } = deps;
  if (point.lastItemId && !point.lastTurnId) throw new Error("聊天分支缺少回合标识");
  const id = forkId(source.id, point);
  // Web 与桌面共享目录。发布前持有同一分支的跨进程租约，重复请求直接读取已完成任务。
  const unlock = await history.leases?.acquire(`acp:task-fork:${id}`);
  try {
    const existing = await store.catalog("task.read", { id });
    if (existing) {
      if (existing.projectId !== source.projectId || existing.provider !== source.provider)
        throw new Error("任务分支身份冲突");
      return localTaskMetadata(existing);
    }
    const releaseSource = await history.cache.acquire(source.id);
    try {
      const active = deps.active();
      if (
        source.sessionId &&
        !active &&
        (!(await history.hasTurns(source.id)) || (await history.needsReplay(source.id)))
      ) {
        await deps.recover();
      }
      const parentTitle = localTaskMetadata(source).title;
      const suffix = " 的复制";
      const title =
        parentTitle.slice(0, 200 - suffix.length).replace(/[\uD800-\uDBFF]$/u, "") + suffix;
      const task: LocalTask = {
        id,
        title,
        provider: source.provider,
        projectId: source.projectId,
        cwd: source.cwd,
        sessionId: null,
        status: "idle",
        archived: false,
        pinned: false,
        updatedAt: Math.floor(Date.now() / 1000),
      };
      let count = 0;
      let boundary: AcpHistoryEntry | undefined;
      let whole = !active && source.status === "idle";
      async function* prefix() {
        for await (const entry of history.entries(source.id)) {
          if (boundary && point.lastTurnId) {
            whole = false;
            break;
          }
          const matches = !point.lastTurnId || point.lastTurnId === entry.turn.id;
          const turn =
            matches && point.lastItemId ? cutTurn(entry.turn, point.lastItemId) : entry.turn;
          if (turn !== entry.turn) whole = false;
          if (matches) boundary = { ...entry, turn };
          await copyAttachments(source.id, id, turn, deps);
          count++;
          yield turn === entry.turn ? entry : turn;
        }
        if (!boundary && active && active.id === point.lastTurnId && point.lastItemId) {
          const selected = active.items.find(({ id }) => id === point.lastItemId);
          if (selected?.type !== "message" || selected.role !== "user")
            throw new Error("请等待该回复完成后再分支");
          // 正在执行的回合可以从已发送的用户消息分支，仅使用点击时的稳定输入。
          const turn = cutTurn(active, point.lastItemId);
          boundary = { turn };
          await copyAttachments(source.id, id, turn, deps);
          count++;
          yield turn;
        }
        if (!boundary) throw new Error("找不到要分支的历史回合");
      }

      let connection: AcpConnection | undefined;
      let publishAttempted = false;
      try {
        await history.replace(id, prefix());
        if (source.sessionId && boundary && !active && !(await history.forkPrefix(source.id))) {
          connection = await deps.connect().catch(() => undefined);
          if (connection?.canForkSessions && !connection.atSessionCapacity) {
            const cursorId = cursorAfter(connection, source.sessionId, boundary);
            if (cursorId || whole) {
              try {
                task.sessionId = await connection.forkSession({
                  sessionId: source.sessionId,
                  cwd: source.cwd,
                  mcpServers: [],
                  ...(cursorId ? { cursorId } : {}),
                });
              } catch (error) {
                // 能力被撤销、Agent 拒绝该分叉点时才降级。传输失败的远端结果未知。
                if (!(error instanceof RequestError) || ![-32601, -32602].includes(error.code))
                  throw error;
              }
            }
          }
        }
        if (!task.sessionId) {
          await history.markForkPrefix(id, count);
          await history.cache.setReplayable(id, false);
        }
        // 正文和附件全部就绪后才发布任务。目录结果未知时保留落盘内容，供幂等重试确认。
        publishAttempted = true;
        const saved = await store.catalog("task.put", task);
        if (connection && saved.sessionId) deps.bind(saved, connection);
        return localTaskMetadata(saved);
      } catch (error) {
        if (!publishAttempted) {
          await Promise.allSettled([history.deleteTask(id), attachments.deleteTask(id)]);
        }
        throw error;
      }
    } finally {
      await releaseSource();
    }
  } finally {
    await unlock?.();
  }
}
