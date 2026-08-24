import * as base from "./fake-app-server-base.mjs";
import * as realtime from "./fake-app-server-realtime.mjs";
import * as stream from "./fake-app-server-stream.mjs";
import { state } from "./fake-app-server-state.mjs";

// 返回 true 表示当前协议领域已经处理该消息。
export function handleProtocolMessage(message) {
  if (message.method === undefined && state.pendingServerRequests.has(message.id)) {
    const pending = state.pendingServerRequests.get(message.id);
    state.pendingServerRequests.delete(message.id);
    state.pendingServerResponses.push({ id: message.id, result: message.result });
    base.send({
      method: "serverRequest/resolved",
      params: { requestId: message.id, threadId: pending.threadId },
    });
    if (pending.completeOnResolve) {
      base.completeActionTurn(pending.threadId, pending.turnId);
    }
    return true;
  }

  if (message.method === "initialize") {
    state.initializeParams = message.params;
    if (state.scenario === "invalid-jsonl") {
      process.stdout.write("not-json\n");
      return true;
    }
    if (state.scenario === "exit-during-initialize") {
      process.stderr.write("fake initialization failure\n");
      process.exit(17);
    }
    base.send({ id: message.id, result: { platformFamily: "unix", userAgent: "fake-codex" } });
    return true;
  }

  if (message.method === "initialized") {
    state.initialized = true;
    return true;
  }

  if (!state.initialized) {
    base.send({ error: { code: -32002, message: "Not initialized" }, id: message.id });
    return true;
  }

  if (message.method === "inspect") {
    base.send({
      id: message.id,
      result: {
        args: state.args,
        initializeParams: state.initializeParams,
        initialized: state.initialized,
      },
    });
    return true;
  }

  if (message.method === "echo") {
    base.send({ id: message.id, result: message.params });
    return true;
  }

  if (message.method === "model/list") {
    base.send({
      id: message.id,
      result: {
        data: [
          {
            defaultReasoningEffort: "high",
            description: "适合复杂编码任务",
            displayName: "GPT-5.6 Sol",
            hidden: false,
            isDefault: true,
            model: "gpt-5.6-sol",
            multiAgentVersion: "v2",
            supportedReasoningEfforts: [
              { description: "快速回答", reasoningEffort: "low" },
              { description: "深入分析", reasoningEffort: "high" },
            ],
          },
          {
            defaultReasoningEffort: "medium",
            description: "适合日常编码任务",
            displayName: "GPT-5.6 Terra",
            hidden: false,
            isDefault: false,
            model: "gpt-5.6-terra",
            multiAgentVersion: null,
            supportedReasoningEfforts: [
              { description: "快速回答", reasoningEffort: "low" },
              { description: "平衡速度与深度", reasoningEffort: "medium" },
            ],
          },
        ],
        nextCursor: null,
      },
    });
    return true;
  }

  if (message.method === "skills/list") {
    const requestedCwds = Array.isArray(message.params?.cwds)
      ? message.params.cwds
      : ["/workspace/Codexly"];
    base.send({
      id: message.id,
      result: {
        data: requestedCwds.map((cwd) => ({ cwd, errors: [], skills: [] })),
      },
    });
    return true;
  }

  if (message.method === "config/read") {
    base.send({
      id: message.id,
      result: {
        config: {
          sandbox_mode: "workspace-write",
        },
        layers: null,
        origins: {},
      },
    });
    return true;
  }

  if (message.method === "account/read") {
    base.send({
      id: message.id,
      result: { account: { type: "apiKey" }, requiresOpenaiAuth: true },
    });
    return true;
  }

  if (message.method === "thread/resume") {
    const threadId = message.params?.threadId;
    // 共享桩按真实协议恢复已持久化 Thread，供后续任务级 RPC 继续使用。
    const thread =
      state.realtimeScenario && threadId === "task-realtime"
        ? base.realtimeThreads.parent
        : state.realtimeScenario && threadId === "frontend-analysis"
          ? base.realtimeThreads.subagent
          : state.actionThreads.get(threadId);
    if (thread === undefined) {
      base.send({
        error: { code: -32600, message: `thread not loaded: ${String(threadId)}` },
        id: message.id,
      });
      return true;
    }
    base.send({ id: message.id, result: { thread } });
    return true;
  }

  if (message.method === "mcpServerStatus/list") {
    base.send({
      id: message.id,
      result: {
        data: [
          {
            authStatus: "notLoggedIn",
            name: "context7",
            pluginId: null,
            resourceTemplates: [],
            resources: [],
            serverInfo: null,
            tools: { "query-docs": {}, "resolve-library-id": {} },
          },
        ],
        nextCursor: null,
      },
    });
    return true;
  }

  if (state.pendingRequestScenario && message.method === "trigger/pending") {
    const kind = message.params?.kind;
    if (
      kind !== "command" &&
      kind !== "elicitation" &&
      kind !== "file" &&
      kind !== "permissions" &&
      kind !== "user_input"
    ) {
      base.send({
        error: { code: -32602, message: "invalid pending request kind" },
        id: message.id,
      });
      return true;
    }
    const requestId = `fake-${kind}-${String(state.nextPendingRequest)}`;
    state.nextPendingRequest += 1;
    base.send({ id: message.id, result: { requestId } });
    base.sendPendingRequest(kind, requestId);
    return true;
  }

  if (state.pendingRequestScenario && message.method === "inspect/pending") {
    base.send({ id: message.id, result: { responses: state.pendingServerResponses } });
    return true;
  }

  if (state.realtimeScenario && message.method === "thread/list") {
    base.send({
      id: message.id,
      result: {
        data: [
          {
            createdAt: 1_753_228_800,
            cwd: "/workspace/Codexly",
            id: "task-realtime",
            name: "Realtime Path",
            preview: "Realtime Path",
            projectId: "codexly",
            section: null,
            sectionEnteredAt: null,
            status: { type: "active" },
            updatedAt: 1_753_228_800,
          },
          ...(state.actionScenario ? [...state.actionThreads.values()] : []),
        ],
        nextCursor: null,
      },
    });
    return true;
  }

  if (
    state.realtimeScenario &&
    message.method === "thread/read" &&
    message.params?.threadId === "task-realtime"
  ) {
    base.send({
      id: message.id,
      result: { thread: base.realtimeThreads.parent },
    });
    stream.scheduleRealtimeEvents();
    return true;
  }

  if ((state.realtimeScenario || state.actionScenario) && message.method === "thread/turns/list") {
    const threadId = message.params?.threadId;
    const thread =
      threadId === base.realtimeThreads.parent.id
        ? base.realtimeThreads.parent
        : threadId === base.realtimeThreads.subagent.id
          ? base.realtimeThreads.subagent
          : state.actionThreads.get(threadId);
    if (thread !== undefined) {
      const itemsView = message.params?.itemsView;
      base.send({
        id: message.id,
        result: {
          backwardsCursor: null,
          data: [...thread.turns]
            .reverse()
            .slice(0, message.params?.limit ?? 10)
            .map((turn) => ({
              ...turn,
              items: itemsView === "notLoaded" ? [] : turn.items,
              itemsView,
            })),
          nextCursor: null,
        },
      });
      return true;
    }
  }

  if ((state.realtimeScenario || state.actionScenario) && message.method === "thread/items/list") {
    const threadId = message.params?.threadId;
    const thread =
      threadId === base.realtimeThreads.parent.id
        ? base.realtimeThreads.parent
        : threadId === base.realtimeThreads.subagent.id
          ? base.realtimeThreads.subagent
          : state.actionThreads.get(threadId);
    if (thread !== undefined) {
      const entries = [...thread.turns]
        .reverse()
        .flatMap((turn) => [...turn.items].reverse().map((item) => ({ item, turnId: turn.id })));
      base.send({
        id: message.id,
        result: {
          backwardsCursor: null,
          data: entries.slice(0, message.params?.limit ?? 100),
          nextCursor: null,
        },
      });
      return true;
    }
  }

  if (
    state.realtimeScenario &&
    message.method === "thread/read" &&
    message.params?.threadId === "frontend-analysis"
  ) {
    base.send({ id: message.id, result: { thread: base.realtimeThreads.subagent } });
    realtime.scheduleSubagentRealtimeEvents();
    return true;
  }
  return false;
}
