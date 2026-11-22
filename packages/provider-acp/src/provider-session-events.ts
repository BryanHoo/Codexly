import type { AgentProviderEventListener } from "@codexly/core";
import type { AcpSubagentIdentity, AgentEngine } from "@codexly/protocol";
import type { AcpClientCallbacks } from "./connection.js";
import type { AcpElicitations } from "./elicitation.js";
import type { AcpPermissions } from "./permissions.js";
import type { AcpProviderConnection } from "./provider-connection.js";
import type { AcpSessionMetadata } from "./session-metadata.js";
import type { SessionNotification } from "@agentclientprotocol/sdk/unstable";
import type { AcpEventProjection } from "./event-projection.js";
import type { AcpReplay } from "./replay.js";
import type { AcpSubagentBackground } from "./subagent-background.js";
import type { AcpSubagentSessions } from "./subagent-sessions.js";

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
  emitNotice: AgentProviderEventListener,
  subagents?: AcpSubagentSessions,
  background?: (taskId: string, root: string) => AcpEventProjection | undefined,
): Promise<void> {
  const child = subagents?.get(sessionId);
  const root = child?.rootSessionId ?? sessionId;
  const replay = replays.get(root);
  const task = taskForAcpSession(sessions, root);
  const projection = task ? active.get(task) : undefined;
  if (update.sessionUpdate === "subagent_update") {
    // 只能从已绑定的根或已登记的子会话扩展树。回放时根绑定尚未发布。
    if (
      (!task && !replay) ||
      update.sessionId === root ||
      update.sessionId === sessionId ||
      taskForAcpSession(sessions, update.sessionId) ||
      replays.has(update.sessionId)
    )
      return;
    const item = subagents?.announce(sessionId, root, update);
    if (!item) return;
    if (replay) await replay.update(update, item);
    else if (task)
      (projection?.running ? projection : background?.(task, root))?.announceSubagent(item);
    return;
  }
  if (historical || replay) {
    await replay?.update(update, child?.item);
    return;
  }
  // 实时用户回显可能含应用指令或由 Agent 展开的附件，沿用原始用户输入。
  if (!child && update.sessionUpdate === "user_message_chunk") return;
  if (!child && update.sessionUpdate === "notice") {
    const title = update.title.trim().slice(0, 8_192);
    if (task && title) {
      // 提示属于会话，空闲时也可抵达。严重级别只影响展示，不触发任务失败。
      emitNotice({
        type: "task.notice",
        taskId: task,
        payload: {
          code: "acp_notice",
          level: "info",
          message: title,
          severity: update.severity,
          ...(update.description ? { description: update.description.slice(0, 8_192) } : {}),
        },
      });
    }
    return;
  }
  if (!task) return;
  // 配置、命令及用量由会话元数据维护，空闲时不为它们创建聊天记录。
  const visible =
    update.sessionUpdate === "agent_message_chunk" ||
    update.sessionUpdate === "agent_thought_chunk" ||
    update.sessionUpdate === "user_message_chunk" ||
    update.sessionUpdate === "session_message" ||
    update.sessionUpdate === "session_message_chunk" ||
    update.sessionUpdate === "tool_call" ||
    update.sessionUpdate === "tool_call_update" ||
    update.sessionUpdate === "plan" ||
    update.sessionUpdate === "compaction_update" ||
    update.sessionUpdate === "compaction_summary_chunk";
  const target = projection?.running ? projection : visible ? background?.(task, root) : undefined;
  target?.update(update, child?.item);
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
  background,
  ephemeral,
  replays,
  permissions,
  elicitations,
}: {
  link: () => AcpProviderConnection;
  engine: AgentEngine;
  emit: AgentProviderEventListener;
  active: ReadonlyMap<string, AcpEventProjection>;
  background: AcpSubagentBackground;
  ephemeral: ReadonlyMap<string, unknown>;
  replays: ReadonlyMap<string, AcpReplay>;
  permissions: AcpPermissions;
  elicitations: AcpElicitations;
}): AcpClientCallbacks {
  const emitNotice: AgentProviderEventListener = (event) => {
    if (!link().detached.has(event.taskId) && !ephemeral.has(event.taskId)) emit(event);
  };
  const backgroundFor = (taskId: string, root: string) =>
    !ephemeral.has(taskId) && link().subagents.hasChildren(root)
      ? background.ensure(taskId)
      : undefined;
  const owner = (sessionId: string) => {
    const connection = link();
    const child = connection.subagents.get(sessionId);
    const root = child?.rootSessionId ?? sessionId;
    const task = taskForAcpSession(connection.sessions, root);
    if (!task || ephemeral.has(task) || replays.has(root)) return;
    const foreground = active.get(task);
    const turn = foreground?.running ? foreground : backgroundFor(task, root);
    if (!turn) return;
    const subagent: AcpSubagentIdentity | undefined = child
      ? { sessionId, ...(child.item.title ? { title: child.item.title } : {}) }
      : undefined;
    return { task, root, turn, subagent };
  };
  return {
    supportsSubagents: true,
    onSessionState: (sessionId, state) => {
      publishAcpSessionState(link(), sessionId, state, emit);
    },
    onUpdate: async (notification, historical) => {
      const { sessions, subagents } = link();
      await routeAcpUpdate(
        notification,
        historical,
        sessions,
        replays,
        active,
        emitNotice,
        subagents,
        backgroundFor,
      );
      const { update } = notification;
      if (update.sessionUpdate !== "subagent_update") return;
      const child = subagents.get(update.sessionId);
      if (
        !child ||
        child.item.parentSessionId !== notification.sessionId ||
        replays.has(child.rootSessionId)
      )
        return;
      const task = taskForAcpSession(sessions, child.rootSessionId);
      if (!task) return;
      if (update.state?.state === "idle") {
        permissions.cancelSubagent(task, update.sessionId);
        elicitations.cancelSubagent(task, update.sessionId);
      }
      if (!subagents.hasWork(child.rootSessionId)) {
        // 落盘异步执行，避免在 Agent 协议读取循环里等待父回合先结束。
        void background.flush(task).catch(() => undefined);
        link().recycleIdle();
      }
    },
    requestPermission: (request, signal) => {
      const found = owner(request.sessionId);
      if (!found) return Promise.resolve({ outcome: { outcome: "cancelled" } });
      const { task, turn, subagent } = found;
      // 审批可能早于工具通知，也可能只发送原生工具 ID。先消费 ACP 提供的同一工具补丁。
      const child = subagent ? link().subagents.get(request.sessionId) : undefined;
      const tool = child
        ? turn.update({ ...request.toolCall, sessionUpdate: "tool_call_update" }, child.item)
        : undefined;
      return permissions.request(task, turn.turnId, request, signal, subagent, tool);
    },
    requestElicitation: (request, signal) => {
      const { instance } = link();
      const sessionId = "sessionId" in request ? request.sessionId : undefined;
      const found = typeof sessionId === "string" ? owner(sessionId) : undefined;
      if (
        !found ||
        !instance ||
        (active.get(found.task)?.running && !instance.canElicitInSession(found.root))
      )
        return Promise.resolve({ action: "cancel" });
      const info = instance.initialization.agentInfo;
      const agent =
        found.subagent?.title ??
        found.subagent?.sessionId ??
        [info?.title, info?.name].find((value) => value?.trim()) ??
        engine;
      return elicitations.request(
        found.task,
        found.turn.turnId,
        agent,
        request,
        signal,
        found.subagent,
      );
    },
    onElicitationComplete: (id) => {
      elicitations.complete(id);
    },
  };
}
