import * as base from "./fake-app-server-base.mjs";
import * as realtime from "./fake-app-server-realtime.mjs";
import { state } from "./fake-app-server-state.mjs";

// 返回 true 表示当前协议领域已经处理该消息。
export function handleActionMessage(message) {
  if (state.actionScenario && message.method === "thread/list") {
    base.send({
      id: message.id,
      result: { data: [...state.actionThreads.values()], nextCursor: null },
    });
    return true;
  }

  if (state.actionScenario && message.method === "thread/start") {
    const threadId = `task-action-${String(state.nextActionTask)}`;
    state.nextActionTask += 1;
    const thread = base.actionThread(threadId, [], message.params?.projectId ?? null);
    state.actionThreads.set(threadId, thread);
    base.send({ id: message.id, result: { thread } });
    return true;
  }

  if (state.actionScenario && message.method === "thread/read") {
    const thread = state.actionThreads.get(message.params?.threadId);
    if (thread === undefined) {
      base.send({
        error: { code: -32600, message: `thread not loaded: ${String(message.params?.threadId)}` },
        id: message.id,
      });
      return true;
    }
    base.send({ id: message.id, result: { thread } });
    return true;
  }

  if (state.actionScenario && message.method === "thread/queue/add") {
    const threadId = message.params?.threadId;
    const queue = base.queuedSubmissions(threadId);
    const queuedSubmission = {
      clientUserMessageId: message.params?.clientUserMessageId,
      id: `queued-${String(state.nextQueuedSubmission)}`,
      input: message.params?.input ?? [],
    };
    state.nextQueuedSubmission += 1;
    queue.push(queuedSubmission);
    base.send({ id: message.id, result: { queuedSubmission } });
    base.notifyQueueChanged(threadId);
    return true;
  }

  if (state.actionScenario && message.method === "thread/queue/list") {
    const queue = base.queuedSubmissions(message.params?.threadId);
    const offset = Number(message.params?.cursor ?? "0");
    const limit = Number(message.params?.limit ?? 100);
    const nextOffset = offset + limit;
    base.send({
      id: message.id,
      result: {
        data: queue.slice(offset, nextOffset),
        nextCursor: nextOffset < queue.length ? String(nextOffset) : null,
      },
    });
    return true;
  }

  if (state.actionScenario && message.method === "thread/queue/update") {
    const queue = base.queuedSubmissions(message.params?.threadId);
    const index = queue.findIndex((item) => item.id === message.params?.queuedSubmissionId);
    const current = queue[index];
    if (current === undefined) {
      base.send({ error: { code: -32600, message: "queue item not found" }, id: message.id });
      return true;
    }
    const queuedSubmission = { ...current, input: message.params?.input ?? [] };
    queue[index] = queuedSubmission;
    base.send({ id: message.id, result: { queuedSubmission } });
    base.notifyQueueChanged(message.params?.threadId);
    return true;
  }

  if (state.actionScenario && message.method === "thread/queue/delete") {
    const threadId = message.params?.threadId;
    const queue = base.queuedSubmissions(threadId);
    const index = queue.findIndex((item) => item.id === message.params?.queuedSubmissionId);
    const deleted = index >= 0;
    if (deleted) {
      queue.splice(index, 1);
    }
    base.send({ id: message.id, result: { deleted } });
    if (deleted) {
      base.notifyQueueChanged(threadId);
    }
    return true;
  }

  if (state.actionScenario && message.method === "thread/queue/reorder") {
    const threadId = message.params?.threadId;
    const queue = base.queuedSubmissions(threadId);
    const byId = new Map(queue.map((item) => [item.id, item]));
    const reordered = (message.params?.queuedSubmissionIds ?? []).flatMap((id) =>
      byId.has(id) ? [byId.get(id)] : [],
    );
    state.queuedSubmissionsByThread.set(threadId, reordered);
    base.send({ id: message.id, result: {} });
    base.notifyQueueChanged(threadId);
    return true;
  }

  if (state.actionScenario && message.method === "thread/queue/start") {
    const threadId = message.params?.threadId;
    const queue = base.queuedSubmissions(threadId);
    const index =
      message.params?.queuedSubmissionId === undefined
        ? 0
        : queue.findIndex((item) => item.id === message.params.queuedSubmissionId);
    const queuedSubmission = index < 0 ? undefined : queue[index];
    const hasRunningTurn = state.actionThreads
      .get(threadId)
      ?.turns.some((turn) => turn.status === "inProgress");
    if (queuedSubmission === undefined || hasRunningTurn === true) {
      base.send({ error: { code: -32600, message: "queue item cannot start" }, id: message.id });
      return true;
    }
    const started = base.beginQueuedActionTurn(threadId, queuedSubmission);
    if (started === undefined) {
      base.send({ error: { code: -32600, message: "thread not loaded" }, id: message.id });
      return true;
    }
    queue.splice(index, 1);
    base.send({ id: message.id, result: { turn: started.turn } });
    base.notifyQueueChanged(threadId);
    base.publishQueuedActionTurn(threadId, started);
    return true;
  }

  if (state.actionScenario && message.method === "turn/start") {
    const threadId = message.params?.threadId;
    const thread = state.actionThreads.get(threadId);
    if (thread === undefined) {
      base.send({
        error: { code: -32600, message: `thread not loaded: ${String(threadId)}` },
        id: message.id,
      });
      return true;
    }
    const turnId = `turn-action-${String(state.nextActionTurn)}`;
    state.nextActionTurn += 1;
    const prompt = message.params?.input?.[0]?.text ?? "";
    const usesSyntheticSnapshotIds = prompt.includes("完成流式回复");
    const userMessage = {
      content: [{ text: prompt, type: "text" }],
      id: usesSyntheticSnapshotIds ? `${turnId}-realtime-user` : `${turnId}-user`,
      type: "userMessage",
    };
    const snapshotUserMessage = usesSyntheticSnapshotIds
      ? { ...userMessage, id: `${turnId}-snapshot-user` }
      : userMessage;
    const storedTurn = base.actionTurn(turnId, "inProgress", [snapshotUserMessage]);
    const startedTurn = usesSyntheticSnapshotIds
      ? base.actionTurn(turnId, "inProgress", [])
      : storedTurn;
    state.actionThreads.set(threadId, base.actionThread(threadId, [...thread.turns, storedTurn]));
    base.send({ id: message.id, result: { turn: startedTurn } });
    base.send({ method: "turn/started", params: { threadId, turn: startedTurn } });
    if (usesSyntheticSnapshotIds) {
      base.send({ method: "item/started", params: { item: userMessage, threadId, turnId } });
      base.send({ method: "item/completed", params: { item: userMessage, threadId, turnId } });
    }
    const pendingKind = prompt.includes("审批命令")
      ? "command"
      : prompt.includes("审批文件")
        ? "file"
        : prompt.includes("审批权限")
          ? "permissions"
          : prompt.includes("用户输入")
            ? "user_input"
            : undefined;
    if (pendingKind !== undefined) {
      const requestId = `fake-${pendingKind}-${String(state.nextPendingRequest)}`;
      state.nextPendingRequest += 1;
      base.sendPendingRequest(
        pendingKind,
        requestId,
        { itemId: `${turnId}-${pendingKind}`, threadId, turnId },
        true,
      );
    } else if (prompt.includes("检查运行状态")) {
      realtime.scheduleOperationStatusTurn(threadId, turnId);
    } else if (!prompt.includes("中断")) {
      setTimeout(() => base.completeActionTurn(threadId, turnId), 120);
    }
    return true;
  }

  if (state.actionScenario && message.method === "turn/steer") {
    const threadId = message.params?.threadId;
    const turnId = message.params?.expectedTurnId;
    const thread = state.actionThreads.get(threadId);
    const runningTurn = thread?.turns.find((turn) => turn.id === turnId);
    if (thread === undefined || runningTurn === undefined || runningTurn.status !== "inProgress") {
      base.send({ error: { code: -32600, message: "turn not found" }, id: message.id });
      return true;
    }
    base.send({ id: message.id, result: { turnId } });
    const messageId = `${turnId}-steer-${String(state.nextSteerMessage)}`;
    const userMessage = {
      content: message.params?.input ?? [],
      id: `${messageId}-user`,
      type: "userMessage",
    };
    state.nextSteerMessage += 1;
    setTimeout(() => {
      const currentThread = state.actionThreads.get(threadId);
      const currentTurn = currentThread?.turns.find((turn) => turn.id === turnId);
      if (
        currentThread === undefined ||
        currentTurn === undefined ||
        currentTurn.status !== "inProgress"
      ) {
        return true;
      }
      state.actionThreads.set(
        threadId,
        base.actionThread(
          threadId,
          currentThread.turns.map((turn) =>
            turn.id === turnId
              ? base.actionTurn(turnId, "inProgress", [...currentTurn.items, userMessage])
              : turn,
          ),
        ),
      );
      base.send({ method: "item/started", params: { item: userMessage, threadId, turnId } });
      base.send({ method: "item/completed", params: { item: userMessage, threadId, turnId } });
    }, 1_000);
    setTimeout(() => {
      const currentThread = state.actionThreads.get(threadId);
      const currentTurn = currentThread?.turns.find((turn) => turn.id === turnId);
      if (
        currentThread === undefined ||
        currentTurn === undefined ||
        currentTurn.status !== "inProgress"
      ) {
        return true;
      }
      const assistantMessage = {
        delivery: null,
        id: messageId,
        memoryCitation: null,
        phase: null,
        questions: null,
        text: "已收到引导",
        type: "agentMessage",
      };
      state.actionThreads.set(
        threadId,
        base.actionThread(
          threadId,
          currentThread.turns.map((turn) =>
            turn.id === turnId
              ? base.actionTurn(turnId, "inProgress", [...currentTurn.items, assistantMessage])
              : turn,
          ),
        ),
      );
      base.send({
        method: "item/agentMessage/delta",
        params: { delta: assistantMessage.text, itemId: messageId, threadId, turnId },
      });
    }, 1_400);
    return true;
  }

  if (state.actionScenario && message.method === "turn/interrupt") {
    const threadId = message.params?.threadId;
    const turnId = message.params?.turnId;
    const thread = state.actionThreads.get(threadId);
    const runningTurn = thread?.turns.find((turn) => turn.id === turnId);
    if (thread === undefined || runningTurn === undefined) {
      base.send({ error: { code: -32600, message: "turn not found" }, id: message.id });
      return true;
    }
    const interruptedTurn = base.actionTurn(turnId, "interrupted", runningTurn.items);
    state.actionThreads.set(
      threadId,
      base.actionThread(
        threadId,
        thread.turns.map((turn) => (turn.id === turnId ? interruptedTurn : turn)),
      ),
    );
    base.send({ id: message.id, result: {} });
    base.send({ method: "turn/completed", params: { threadId, turn: interruptedTurn } });
    setTimeout(() => base.startNextQueuedSubmission(threadId), 20);
    return true;
  }
  return false;
}
