import { state } from "./fake-app-server-state.mjs";

// 提供请求、线程、队列和响应的基础协议操作。
export function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

export function pendingRequestParams(
  kind,
  identity = { itemId: `${kind}-item`, threadId: "task-1", turnId: "turn-1" },
) {
  if (kind === "elicitation") {
    return {
      message: "Allow this request?",
      mode: "form",
      requestedSchema: {
        properties: {
          confirmed: { title: "Confirm", type: "boolean" },
        },
        required: ["confirmed"],
        type: "object",
      },
      serverName: "fake-mcp",
      threadId: identity.threadId,
      turnId: identity.turnId,
    };
  }
  if (kind === "command") {
    return {
      ...identity,
      availableDecisions: ["accept", "acceptForSession", "decline"],
      command: "pnpm check",
      cwd: "/workspace/Codexly",
      reason: "需要执行检查",
      startedAtMs: 1_753_228_800_000,
    };
  }
  if (kind === "file") {
    return {
      ...identity,
      grantRoot: "/workspace/Codexly",
      reason: "需要修改文件",
      startedAtMs: 1_753_228_801_000,
    };
  }
  if (kind === "permissions") {
    return {
      ...identity,
      cwd: "/workspace/Codexly",
      environmentId: "local",
      permissions: {
        fileSystem: {
          entries: [
            {
              access: "write",
              path: { path: "/workspace/Codexly/.cache", type: "path" },
            },
          ],
          globScanMaxDepth: 4,
          read: null,
          write: null,
        },
        network: { enabled: true },
      },
      reason: "需要访问网络并写入缓存",
      startedAtMs: 1_753_228_802_000,
    };
  }
  return {
    ...identity,
    autoResolutionMs: 30_000,
    isBlocking: false,
    questions: [
      {
        header: "执行模式",
        id: "mode",
        isOther: true,
        isSecret: false,
        options: [
          { description: "继续实现", label: "继续" },
          { description: "停止当前工作", label: "停止" },
        ],
        question: "下一步怎么处理？",
      },
    ],
  };
}

export function sendPendingRequest(
  kind,
  requestId,
  identity = { itemId: `${kind}-item`, threadId: "task-1", turnId: "turn-1" },
  completeOnResolve = false,
) {
  const method =
    kind === "command"
      ? "item/commandExecution/requestApproval"
      : kind === "file"
        ? "item/fileChange/requestApproval"
        : kind === "permissions"
          ? "item/permissions/requestApproval"
          : kind === "elicitation"
            ? "mcpServer/elicitation/request"
            : "item/tool/requestUserInput";
  state.pendingServerRequests.set(requestId, {
    completeOnResolve,
    kind,
    threadId: identity.threadId,
    turnId: identity.turnId,
  });
  send({ id: requestId, method, params: pendingRequestParams(kind, identity) });
}

export function realtimeTurn(status, items, error = null) {
  return {
    completedAt: status === "inProgress" ? null : 1_753_228_802,
    durationMs: status === "inProgress" ? null : 2_000,
    error,
    id: "turn-realtime",
    items,
    itemsView: { type: "full" },
    startedAt: 1_753_228_800,
    status,
  };
}

export function realtimeThread(turns = []) {
  return {
    createdAt: 1_753_228_800,
    cwd: "/workspace/Codexly",
    historyMode: "paginated",
    id: "task-realtime",
    name: "Realtime Path",
    preview: "Realtime Path",
    projectId: "codexly",
    section: null,
    sectionEnteredAt: null,
    status: { type: turns.some((turn) => turn.status === "inProgress") ? "active" : "notLoaded" },
    turns,
    updatedAt: 1_753_228_800 + turns.length,
  };
}

// 跨模块调度通过稳定对象更新线程，避免写入只读的 ESM namespace binding。
export const realtimeThreads = { parent: realtimeThread(), subagent: null };

export function actionThread(id, turns = [], projectId = "codexly") {
  return {
    createdAt: 1_753_228_800,
    cwd: "/workspace/Codexly",
    historyMode: "paginated",
    id,
    name: "Agent Action",
    preview: "Agent Action",
    projectId,
    section: null,
    sectionEnteredAt: null,
    status: { type: turns.some((turn) => turn.status === "inProgress") ? "active" : "notLoaded" },
    turns,
    updatedAt: 1_753_228_800 + turns.length,
  };
}

export function actionTurn(id, status, items) {
  return {
    completedAt: status === "inProgress" ? null : 1_753_228_802,
    durationMs: status === "inProgress" ? null : 2_000,
    error: null,
    id,
    items,
    itemsView: { type: "full" },
    startedAt: 1_753_228_800,
    status,
  };
}

export function queuedSubmissions(threadId) {
  const existing = state.queuedSubmissionsByThread.get(threadId);
  if (existing !== undefined) {
    return existing;
  }
  const created = [];
  state.queuedSubmissionsByThread.set(threadId, created);
  return created;
}

export function notifyQueueChanged(threadId) {
  send({ method: "thread/queue/changed", params: { threadId } });
}

export function beginQueuedActionTurn(threadId, queuedSubmission) {
  const thread = state.actionThreads.get(threadId);
  if (thread === undefined) {
    return undefined;
  }
  const turnId = `turn-action-${String(state.nextActionTurn)}`;
  state.nextActionTurn += 1;
  const userMessage = {
    content: queuedSubmission.input,
    id: `${turnId}-user`,
    type: "userMessage",
  };
  const turn = actionTurn(turnId, "inProgress", [userMessage]);
  state.actionThreads.set(threadId, actionThread(threadId, [...thread.turns, turn]));
  return { turn, userMessage };
}

export function publishQueuedActionTurn(threadId, started) {
  const turnId = started.turn.id;
  send({ method: "turn/started", params: { threadId, turn: started.turn } });
  send({ method: "item/started", params: { item: started.userMessage, threadId, turnId } });
  send({ method: "item/completed", params: { item: started.userMessage, threadId, turnId } });
  setTimeout(() => completeActionTurn(threadId, turnId), 120);
}

export function startNextQueuedSubmission(threadId) {
  const queue = queuedSubmissions(threadId);
  const queuedSubmission = queue.shift();
  if (queuedSubmission === undefined) {
    return;
  }
  const started = beginQueuedActionTurn(threadId, queuedSubmission);
  if (started === undefined) {
    queue.unshift(queuedSubmission);
    return;
  }
  notifyQueueChanged(threadId);
  publishQueuedActionTurn(threadId, started);
}

realtimeThreads.subagent = actionThread("frontend-analysis", [
  actionTurn("turn-frontend-analysis", "inProgress", [
    {
      content: [{ text: "理解前端项目", type: "text" }],
      id: "frontend-analysis-user",
      type: "userMessage",
    },
  ]),
]);

export function completeActionTurn(threadId, turnId) {
  const thread = state.actionThreads.get(threadId);
  const runningTurn = thread?.turns.find((turn) => turn.id === turnId);
  if (thread === undefined || runningTurn === undefined || runningTurn.status !== "inProgress") {
    return;
  }
  const usesSyntheticSnapshotIds = runningTurn.items.some(
    (item) => item.id === `${turnId}-snapshot-user`,
  );
  const message = {
    delivery: null,
    id: usesSyntheticSnapshotIds ? `${turnId}-realtime-assistant` : `${turnId}-assistant`,
    memoryCitation: null,
    phase: null,
    text: "流式回复完成",
    type: "agentMessage",
  };
  const snapshotMessage = usesSyntheticSnapshotIds
    ? { ...message, id: `${turnId}-snapshot-assistant` }
    : message;
  const completedTurn = actionTurn(turnId, "completed", [...runningTurn.items, snapshotMessage]);
  state.actionThreads.set(
    threadId,
    actionThread(
      threadId,
      thread.turns.map((turn) => (turn.id === turnId ? completedTurn : turn)),
    ),
  );
  for (const delta of ["流式回复", "完成"]) {
    send({
      method: "item/agentMessage/delta",
      params: { delta, itemId: message.id, threadId, turnId },
    });
  }
  send({
    method: "item/completed",
    params: { item: message, threadId, turnId },
  });
  send({
    method: "thread/tokenUsage/updated",
    params: {
      threadId,
      tokenUsage: {
        last: { totalTokens: 25_000 },
        modelContextWindow: 200_000,
        total: { totalTokens: 25_000 },
      },
      turnId,
    },
  });
  send({
    method: "turn/completed",
    params: {
      threadId,
      // Codex 0.146 的终态可能只携带实时 Assistant，完整历史由 thread/read 补齐。
      turn: usesSyntheticSnapshotIds ? actionTurn(turnId, "completed", [message]) : completedTurn,
    },
  });
  setTimeout(() => startNextQueuedSubmission(threadId), 20);
}
