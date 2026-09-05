import * as base from "./fake-app-server-base.mjs";
import { state } from "./fake-app-server-state.mjs";

// 调度 subagent 与 operation status realtime 事件。
export function scheduleSubagentRealtimeEvents() {
  if (state.subagentRealtimeRunning) {
    return;
  }
  state.subagentRealtimeRunning = true;
  const threadId = "frontend-analysis";
  const turnId = "turn-frontend-analysis";
  const messageId = "frontend-analysis-message";
  const firstMessage = {
    delivery: null,
    id: messageId,
    memoryCitation: null,
    phase: null,
    questions: null,
    text: "正在分析前端",
    type: "agentMessage",
  };

  setTimeout(() => {
    const runningTurn = base.realtimeThreads.subagent.turns[0];
    base.realtimeThreads.subagent = base.actionThread(threadId, [
      base.actionTurn(turnId, "inProgress", [...runningTurn.items, firstMessage]),
    ]);
    base.send({
      method: "item/agentMessage/delta",
      params: { delta: firstMessage.text, itemId: messageId, threadId, turnId },
    });
  }, 120);

  setTimeout(() => {
    const completedMessage = {
      ...firstMessage,
      text: "正在分析前端\n前端流式分析完成",
    };
    const userMessage = base.realtimeThreads.subagent.turns[0].items[0];
    const completedTurn = base.actionTurn(turnId, "completed", [userMessage, completedMessage]);
    base.realtimeThreads.subagent = base.actionThread(threadId, [completedTurn]);
    base.send({
      method: "item/agentMessage/delta",
      params: { delta: "\n前端流式分析完成", itemId: messageId, threadId, turnId },
    });
    base.send({
      method: "item/completed",
      params: { item: completedMessage, threadId, turnId },
    });
    base.send({ method: "turn/completed", params: { threadId, turn: completedTurn } });
  }, 700);
}

export function scheduleOperationStatusTurn(threadId, turnId) {
  const runningCommand = {
    aggregatedOutput: null,
    command: "rg --files",
    commandActions: [],
    cwd: "/workspace/Codexly",
    durationMs: null,
    exitCode: null,
    id: `${turnId}-status-command`,
    processId: null,
    source: "agent",
    status: "inProgress",
    type: "commandExecution",
  };
  const runningTool = {
    arguments: { libraryId: "/openai/codex", query: "live shimmer continuity" },
    error: null,
    id: `${turnId}-status-tool`,
    result: null,
    server: "context7",
    status: "inProgress",
    tool: "query-docs",
    type: "mcpToolCall",
  };

  setTimeout(() => {
    const thread = state.actionThreads.get(threadId);
    const runningTurn = thread?.turns.find((turn) => turn.id === turnId);
    if (thread === undefined || runningTurn === undefined) {
      return;
    }
    // 先更新读取快照，确保订阅建立在通知之后时仍能恢复当前运行项。
    state.actionThreads.set(
      threadId,
      base.actionThread(
        threadId,
        thread.turns.map((turn) =>
          turn.id === turnId
            ? { ...runningTurn, items: [...runningTurn.items, runningCommand] }
            : turn,
        ),
      ),
    );
    base.send({
      method: "item/started",
      params: { item: runningCommand, threadId, turnId },
    });
  }, 120);

  setTimeout(() => {
    const thread = state.actionThreads.get(threadId);
    const runningTurn = thread?.turns.find((turn) => turn.id === turnId);
    if (thread === undefined || runningTurn === undefined) {
      return;
    }
    const completedCommand = {
      ...runningCommand,
      aggregatedOutput: "",
      durationMs: 580,
      exitCode: 0,
      status: "completed",
    };
    state.actionThreads.set(
      threadId,
      base.actionThread(
        threadId,
        thread.turns.map((turn) =>
          turn.id === turnId
            ? {
                ...runningTurn,
                items: runningTurn.items.map((item) =>
                  item.id === completedCommand.id ? completedCommand : item,
                ),
              }
            : turn,
        ),
      ),
    );
    base.send({
      method: "item/completed",
      params: { item: completedCommand, threadId, turnId },
    });
  }, 700);

  setTimeout(() => {
    const thread = state.actionThreads.get(threadId);
    const runningTurn = thread?.turns.find((turn) => turn.id === turnId);
    if (thread === undefined || runningTurn === undefined) {
      return;
    }
    state.actionThreads.set(
      threadId,
      base.actionThread(
        threadId,
        thread.turns.map((turn) =>
          turn.id === turnId
            ? { ...runningTurn, items: [...runningTurn.items, runningTool] }
            : turn,
        ),
      ),
    );
    base.send({
      method: "item/started",
      params: { item: runningTool, threadId, turnId },
    });
  }, 1_100);

  setTimeout(() => {
    const thread = state.actionThreads.get(threadId);
    const runningTurn = thread?.turns.find((turn) => turn.id === turnId);
    if (thread === undefined || runningTurn === undefined) {
      return;
    }
    const completedTool = {
      ...runningTool,
      result: { matches: [] },
      status: "completed",
    };
    state.actionThreads.set(
      threadId,
      base.actionThread(
        threadId,
        thread.turns.map((turn) =>
          turn.id === turnId
            ? {
                ...runningTurn,
                items: runningTurn.items.map((item) =>
                  item.id === completedTool.id ? completedTool : item,
                ),
              }
            : turn,
        ),
      ),
    );
    base.send({
      method: "item/completed",
      params: { item: completedTool, threadId, turnId },
    });
  }, 1_500);

  setTimeout(() => base.completeActionTurn(threadId, turnId), 1_900);
}
