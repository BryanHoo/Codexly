import type { SessionNotification } from "@agentclientprotocol/sdk/unstable";
import type { AcpEventProjection } from "./event-projection.js";
import type { AcpReplay } from "./replay.js";

/** 使用有界会话映射定位任务，流式增量无需复制任务列表。 */
export function taskForAcpSession(sessions: ReadonlyMap<string, string>, sessionId: string) {
  for (const [task, session] of sessions) if (session === sessionId) return task;
  return undefined;
}

export async function routeAcpUpdate(
  { sessionId, update }: SessionNotification,
  historical: boolean,
  sessions: ReadonlyMap<string, string>,
  replays: ReadonlyMap<string, AcpReplay>,
  active: ReadonlyMap<string, AcpEventProjection>,
): Promise<void> {
  if (historical) {
    await replays.get(sessionId)?.update(update);
    return;
  }
  // 实时用户回显可能含应用指令或由 Agent 展开的附件，沿用原始用户输入。
  if (update.sessionUpdate === "user_message_chunk") return;
  const task = taskForAcpSession(sessions, sessionId);
  const projection = task ? active.get(task) : undefined;
  if (projection?.running) projection.update(update);
}
