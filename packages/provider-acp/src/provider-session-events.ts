import type { AgentProviderEventListener } from "@codexly/core";
import type { AgentEngine } from "@codexly/protocol";
import type { AcpClientCallbacks } from "./connection.js";
import type { AcpElicitations } from "./elicitation.js";
import type { AcpPermissions } from "./permissions.js";
import type { AcpProviderConnection } from "./provider-connection.js";
import type { AcpSessionMetadata } from "./session-metadata.js";
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

export function publishAcpSessionState(
  link: AcpProviderConnection,
  sessionId: string,
  state: AcpSessionMetadata,
  emit: AgentProviderEventListener,
): void {
  const task = taskForAcpSession(link.sessions, sessionId);
  if (task && !link.detached.has(task))
    emit({
      type: "acp.session.updated",
      taskId: task,
      payload: { state: link.instance?.supportsSteering ? { ...state, canSteer: true } : state },
    });
  else if (task && state.background?.length === 0) link.recycleIdle();
}

/** 会话身份由宿主持有。未绑定、已取消及内部辅助会话没有可用的用户交互界面。 */
export function acpSessionCallbacks({
  link,
  engine,
  emit,
  active,
  ephemeral,
  replays,
  permissions,
  elicitations,
}: {
  link: () => AcpProviderConnection;
  engine: AgentEngine;
  emit: AgentProviderEventListener;
  active: ReadonlyMap<string, AcpEventProjection>;
  ephemeral: ReadonlyMap<string, unknown>;
  replays: ReadonlyMap<string, AcpReplay>;
  permissions: AcpPermissions;
  elicitations: AcpElicitations;
}): AcpClientCallbacks {
  return {
    onSessionState: (sessionId, state) => {
      publishAcpSessionState(link(), sessionId, state, emit);
    },
    onUpdate: (notification, historical) =>
      routeAcpUpdate(notification, historical, link().sessions, replays, active),
    requestPermission: (request, signal) => {
      const task = taskForAcpSession(link().sessions, request.sessionId);
      const turn = task ? active.get(task) : undefined;
      return task && turn?.running && !ephemeral.has(task)
        ? permissions.request(task, turn.turnId, request, signal)
        : Promise.resolve({ outcome: { outcome: "cancelled" } });
    },
    requestElicitation: (request, signal) => {
      const { instance, sessions } = link();
      const sessionId = "sessionId" in request ? request.sessionId : undefined;
      if (typeof sessionId !== "string" || !instance?.canElicitInSession(sessionId))
        return Promise.resolve({ action: "cancel" });
      const taskId = taskForAcpSession(sessions, sessionId);
      const turn = taskId ? active.get(taskId) : undefined;
      if (!taskId || !turn?.running || ephemeral.has(taskId))
        return Promise.resolve({ action: "cancel" });
      const info = instance.initialization.agentInfo;
      const agent = [info?.title, info?.name].find((value) => value?.trim()) ?? engine;
      return elicitations.request(taskId, turn.turnId, agent, request, signal);
    },
    onElicitationComplete: (id) => {
      elicitations.complete(id);
    },
  };
}
