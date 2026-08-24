import * as base from "./fake-app-server-base.mjs";
import { state } from "./fake-app-server-state.mjs";

// 调度完整 Turn 流式事件序列。
export function scheduleRealtimeEvents() {
  if (state.realtimeRunning) {
    return;
  }
  state.realtimeRunning = true;
  setTimeout(() => {
    const messageItem = {
      delivery: null,
      id: "message-realtime",
      memoryCitation: null,
      phase: null,
      text: "Realtime connected",
      type: "agentMessage",
    };
    const commandItem = {
      aggregatedOutput: "Done\n",
      command: "pnpm check",
      commandActions: [],
      cwd: "/workspace/CodeAgent",
      durationMs: 20,
      exitCode: 0,
      id: "command-realtime",
      processId: null,
      source: "agent",
      status: "completed",
      type: "commandExecution",
    };
    const startedSubagentItem = {
      agentsStates: {},
      id: "subagent-realtime",
      model: "gpt-5.6-sol",
      prompt: "理解前端项目",
      reasoningEffort: "high",
      receiverThreadIds: [],
      senderThreadId: "task-realtime",
      status: "inProgress",
      tool: "spawnAgent",
      type: "collabAgentToolCall",
    };
    const completedSubagentItem = {
      ...startedSubagentItem,
      agentsStates: {
        "frontend-analysis": {
          message: "前端由 React 工作台与类型安全 Client 组成。",
          status: "completed",
        },
      },
      receiverThreadIds: ["frontend-analysis"],
      status: "completed",
    };
    const subagentActivityItem = {
      agentPath: "/root/frontend_analysis",
      agentThreadId: "frontend-analysis",
      id: "subagent-activity-realtime",
      kind: "started",
      type: "subAgentActivity",
    };
    base.realtimeThreads.parent = base.realtimeThread([base.realtimeTurn("inProgress", [])]);
    base.send({
      method: "turn/started",
      params: { threadId: "task-realtime", turn: base.realtimeTurn("inProgress", []) },
    });
    // 先交付运行态，再用同一 Item ID 的完成事件替换为子代理结果。
    base.send({
      method: "item/started",
      params: {
        item: startedSubagentItem,
        threadId: "task-realtime",
        turnId: "turn-realtime",
      },
    });
    for (const delta of ["Realtime ", "connected"]) {
      base.send({
        method: "item/agentMessage/delta",
        params: {
          delta,
          itemId: "message-realtime",
          threadId: "task-realtime",
          turnId: "turn-realtime",
        },
      });
    }
    base.send({
      method: "item/completed",
      params: {
        completedAtMs: 1_753_228_801_000,
        item: messageItem,
        threadId: "task-realtime",
        turnId: "turn-realtime",
      },
    });
    base.send({
      method: "item/commandExecution/outputDelta",
      params: {
        delta: "Done\n",
        itemId: "command-realtime",
        threadId: "task-realtime",
        turnId: "turn-realtime",
      },
    });
    base.send({
      method: "item/completed",
      params: {
        completedAtMs: 1_753_228_801_500,
        item: commandItem,
        threadId: "task-realtime",
        turnId: "turn-realtime",
      },
    });
    base.send({
      method: "item/completed",
      params: {
        completedAtMs: 1_753_228_801_750,
        item: completedSubagentItem,
        threadId: "task-realtime",
        turnId: "turn-realtime",
      },
    });
    base.send({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "task-realtime",
        tokenUsage: {
          last: { totalTokens: 25_000 },
          modelContextWindow: 200_000,
          total: { totalTokens: 100_000 },
        },
        turnId: "turn-realtime",
      },
    });
    base.send({
      method: "turn/completed",
      params: {
        threadId: "task-realtime",
        turn: base.realtimeTurn("completed", [
          messageItem,
          commandItem,
          completedSubagentItem,
          subagentActivityItem,
        ]),
      },
    });
    base.realtimeThreads.parent = base.realtimeThread([
      base.realtimeTurn("completed", [
        messageItem,
        commandItem,
        completedSubagentItem,
        subagentActivityItem,
      ]),
    ]);
    base.send({
      method: "error",
      params: {
        error: { message: "模型服务不可用" },
        threadId: "task-realtime",
        turnId: "turn-realtime",
        willRetry: false,
      },
    });
    // 同一 App Server 进程只调度一次，避免后续 Snapshot 刷新反复替换已完成的父线程。
  }, 750);
}
