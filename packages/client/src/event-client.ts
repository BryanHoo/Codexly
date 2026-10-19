import {
  EventStreamMessageSchema,
  MAX_EVENT_BATCH_BYTES,
  TEMPORARY_TASK_API_PATH,
  TEMPORARY_TASK_SCOPE_ID,
  type AgentEvent,
  type EventStreamMessage,
  type ResyncRequired,
} from "@codexly/protocol";
import { Value } from "@sinclair/typebox/value";
import { getWebSocketReconnectDelay, shouldReconnectWebSocket } from "./websocket-reconnect.js";

export type AgentEventConnectionState = "closed" | "connected" | "connecting" | "reconnecting";

export type WebSocketFactory = (url: string) => WebSocket;

export interface SubscribeAgentEventsOptions {
  afterSequence: number;
  onConnectionState?: (state: AgentEventConnectionState) => void;
  onError?: (error: Error) => void;
  onEvent: (event: AgentEvent) => void;
  onResyncRequired: (message: ResyncRequired) => void;
  projectId: string;
  reconnectDelayMs?: number;
  sessionId: string;
}

interface StartAgentEventSubscriptionOptions extends SubscribeAgentEventsOptions {
  baseUrl: string;
  webSocketFactory: WebSocketFactory;
}

export class CodexlyEventError extends Error {
  public readonly closeCode: number | undefined;

  public constructor(message: string, options?: ErrorOptions & { closeCode?: number }) {
    super(message, options);
    this.name = "CodexlyEventError";
    this.closeCode = options?.closeCode;
  }
}

function createEventUrl(baseUrl: string, projectId: string, afterSequence: number): string {
  const path =
    projectId === TEMPORARY_TASK_SCOPE_ID
      ? `${TEMPORARY_TASK_API_PATH}/events`
      : `/v1/projects/${encodeURIComponent(projectId)}/events`;
  const httpUrl = baseUrl ? new URL(`${baseUrl}${path}`) : new URL(path, globalThis.location.href);
  httpUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
  httpUrl.searchParams.set("afterSequence", String(afterSequence));
  return httpUrl.toString();
}

function createResyncRequired(
  sessionId: string,
  latestSequence: number,
  reason: ResyncRequired["reason"],
): ResyncRequired {
  return {
    latestSequence,
    reason,
    sessionId,
    type: "resync.required",
    version: 3,
  };
}

function exceedsEventFrameBudget(data: string): boolean {
  if (data.length > MAX_EVENT_BATCH_BYTES) return true;
  // 每个 UTF-16 单元最多占 3 个 UTF-8 字节，小帧无需扫描或分配编码缓冲。
  if (data.length * 3 <= MAX_EVENT_BATCH_BYTES) return false;
  let bytes = 0;
  for (let index = 0; index < data.length; index += 1) {
    const codePoint = data.codePointAt(index);
    if (codePoint === undefined) break;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (bytes > MAX_EVENT_BATCH_BYTES) return true;
    if (codePoint > 0xffff) index += 1;
  }
  return false;
}

export function startAgentEventSubscription(
  options: StartAgentEventSubscriptionOptions,
): () => void {
  const reconnectDelayMs = options.reconnectDelayMs ?? 250;
  let active = true;
  let allowReconnect = true;
  let lastSequence = options.afterSequence;
  let reconnectAttempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let socket: WebSocket | undefined;
  let detachSocketListeners: (() => void) | undefined;

  const setState = (state: AgentEventConnectionState) => {
    options.onConnectionState?.(state);
  };

  const closeSocket = (code: number, reason: string) => {
    const currentSocket = socket;
    if (currentSocket === undefined) {
      return;
    }
    detachSocketListeners?.();
    detachSocketListeners = undefined;
    socket = undefined;
    currentSocket.close(code, reason);
  };

  const stopForResync = (message: ResyncRequired) => {
    allowReconnect = false;
    options.onResyncRequired(message);
    closeSocket(1000, "Snapshot resync required");
    setState("closed");
  };

  const failProtocol = (message: string, cause?: unknown) => {
    allowReconnect = false;
    // 浏览器只允许主动发送 1000 或应用关闭码；协议原因通过错误对象交付上层。
    closeSocket(1000, "Invalid Agent Event frame");
    options.onError?.(new CodexlyEventError(message, { cause, closeCode: 1002 }));
    setState("closed");
  };

  const reportConnectionError = (cause?: unknown) => {
    options.onError?.(new CodexlyEventError("Codexly event connection failed", { cause }));
  };

  const canReconnect = () => active && allowReconnect;

  const retry = () => {
    if (!canReconnect()) return;
    setState("reconnecting");
    // 状态回调可能同步取消订阅，取消后不得再登记重试定时器。
    if (!canReconnect()) return;
    retryTimer = setTimeout(
      connect,
      getWebSocketReconnectDelay(reconnectAttempt++, reconnectDelayMs, 5_000),
    );
  };

  const connect = () => {
    if (!active || !allowReconnect) {
      return;
    }
    retryTimer = undefined;
    let connectionReady = false;
    let currentSocket: WebSocket;
    try {
      currentSocket = options.webSocketFactory(
        createEventUrl(options.baseUrl, options.projectId, lastSequence),
      );
    } catch (cause) {
      // 工厂同步失败与异步网络错误共用错误出口，仍可退避和取消。
      reportConnectionError(cause);
      retry();
      return;
    }
    socket = currentSocket;
    const isCurrentConnection = () => active && socket === currentSocket;

    const onMessage = (event: MessageEvent) => {
      if (!isCurrentConnection()) {
        return;
      }
      if (typeof event.data !== "string") {
        failProtocol("Codexly event frame must be text");
        return;
      }
      // 浏览器 WebSocket 无接收背压；解析前限制完整帧，避免巨帧继续扩张 JS 堆与验证开销。
      if (exceedsEventFrameBudget(event.data)) {
        stopForResync(
          createResyncRequired(options.sessionId, lastSequence, "event_retention_exceeded"),
        );
        return;
      }
      let frame: unknown;
      try {
        frame = JSON.parse(event.data) as unknown;
      } catch (error) {
        failProtocol("Codexly event frame is not valid JSON", error);
        return;
      }
      if (!Value.Check(EventStreamMessageSchema, frame)) {
        failProtocol("Codexly event frame does not match the protocol schema");
        return;
      }
      // Agent Event Schema 不含 Transform，Check 成功后直接使用已验证数据，避免二次深遍历。
      const message = frame as EventStreamMessage;

      if (message.type === "resync.required") {
        stopForResync(message);
        return;
      }
      if (message.type === "connection.ready") {
        if (message.sessionId !== options.sessionId || message.latestSequence < lastSequence) {
          stopForResync(
            createResyncRequired(message.sessionId, message.latestSequence, "session_changed"),
          );
          return;
        }
        connectionReady = true;
        reconnectAttempt = 0;
        setState("connected");
        return;
      }
      if (!connectionReady) {
        failProtocol("Codexly event arrived before connection.ready");
        return;
      }
      for (const agentEvent of message.events) {
        if (agentEvent.sessionId !== options.sessionId) {
          stopForResync(
            createResyncRequired(agentEvent.sessionId, agentEvent.sequence, "session_changed"),
          );
          return;
        }
        if (agentEvent.sequence <= lastSequence) {
          continue;
        }
        if (agentEvent.sequence !== lastSequence + 1) {
          stopForResync(
            createResyncRequired(agentEvent.sessionId, agentEvent.sequence, "sequence_gap"),
          );
          return;
        }
        lastSequence = agentEvent.sequence;
        // 批内仍逐事件交付，保持现有 Store 回调和 sequence 恢复语义。
        options.onEvent(agentEvent);
        if (!isCurrentConnection()) {
          return;
        }
      }
    };

    const onError = () => {
      if (!active || socket !== currentSocket) {
        return;
      }
      reportConnectionError();
    };

    const onClose = (event: CloseEvent) => {
      if (socket !== currentSocket) {
        return;
      }
      if (active && event.code === 1009) {
        // 超大事件不可重放，直接沿用快照恢复路径，避免重连后再次接收相同正文。
        stopForResync(
          createResyncRequired(options.sessionId, lastSequence, "event_retention_exceeded"),
        );
        return;
      }
      detachSocketListeners?.();
      detachSocketListeners = undefined;
      socket = undefined;
      if (!active) {
        return;
      }
      if (!shouldReconnectWebSocket(event.code)) {
        // 1008 无法区分认证失效与项目不可用，交付访问错误并停止本订阅，避免误判为网络恢复。
        allowReconnect = false;
        options.onError?.(
          new CodexlyEventError(
            event.code === 1008
              ? "Codexly event access is unavailable; sign in again or reopen an available project"
              : "Codexly event connection was rejected by the protocol",
            { closeCode: event.code },
          ),
        );
        setState("closed");
        return;
      }
      if (!allowReconnect) {
        setState("closed");
        return;
      }
      retry();
    };

    // 保存处理器引用，确保取消或替换连接后不会交付迟到事件。
    detachSocketListeners = () => {
      currentSocket.removeEventListener("message", onMessage);
      currentSocket.removeEventListener("error", onError);
      currentSocket.removeEventListener("close", onClose);
    };
    currentSocket.addEventListener("message", onMessage);
    currentSocket.addEventListener("error", onError);
    currentSocket.addEventListener("close", onClose);
  };

  setState("connecting");
  connect();

  return () => {
    if (!active) {
      return;
    }
    active = false;
    allowReconnect = false;
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
    }
    closeSocket(1000, "Subscription cancelled");
    setState("closed");
  };
}
