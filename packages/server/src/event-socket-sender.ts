import { Buffer } from "node:buffer";

import {
  MAX_EVENT_BATCH_SIZE,
  MAX_AGENT_EVENT_BYTES,
  MAX_EVENT_BATCH_BYTES,
  type AgentEvent,
  type EventStreamMessage,
} from "@codexly/protocol";

const EVENT_SOCKET_SOFT_BACKPRESSURE_BYTES = 256 * 1_024;
const EVENT_SOCKET_HARD_BACKPRESSURE_BYTES = 1_024 * 1_024;
const EVENT_BATCH_PREFIX = '{"events":[';
const EVENT_BATCH_SUFFIX = '],"type":"events.batch","version":3}';
const EVENT_BATCH_ENVELOPE_BYTES = EVENT_BATCH_PREFIX.length + EVENT_BATCH_SUFFIX.length;
const serializedMessages = new WeakMap<object, SerializedEventStreamMessage>();
const serializedEventBatches = new WeakMap<AgentEvent, Map<number, SerializedEventBatch>>();

type SerializedEventBatch = Readonly<{
  events: readonly AgentEvent[];
  message: SerializedEventStreamMessage;
}>;

export type SerializedEventStreamMessage = Readonly<{
  byteLength: number;
  data: string;
}>;

export interface EventStreamSocket {
  readonly bufferedAmount: number;
  readonly readyState: number;
  close: (code: number, reason: string) => void;
  send: (data: string) => void;
}

function serializeEventStreamValue(value: object): SerializedEventStreamMessage {
  const cached = serializedMessages.get(value);
  if (cached !== undefined) {
    return cached;
  }
  const data = JSON.stringify(value);
  const serialized = { byteLength: Buffer.byteLength(data), data };
  // WeakMap 只随协议对象存活，复用序列化结果且不延长事件生命周期。
  serializedMessages.set(value, serialized);
  return serialized;
}

export function serializeEventStreamMessage(
  message: EventStreamMessage,
): SerializedEventStreamMessage {
  return serializeEventStreamValue(message);
}

export function getSerializedAgentEventByteLength(event: AgentEvent): number {
  return serializeEventStreamValue(event).byteLength;
}

function hasSameEvents(
  cachedEvents: readonly AgentEvent[],
  events: readonly AgentEvent[],
  offset: number,
  end: number,
): boolean {
  if (cachedEvents.length !== end - offset) {
    return false;
  }
  return cachedEvents.every((event, index) => event === events[offset + index]);
}

function serializeEventBatch(
  events: readonly AgentEvent[],
  offset: number,
): SerializedEventBatch | undefined {
  const maxEnd = Math.min(offset + MAX_EVENT_BATCH_SIZE, events.length);
  let end = offset;
  let byteLength = EVENT_BATCH_ENVELOPE_BYTES;
  const serializedEvents: SerializedEventStreamMessage[] = [];
  for (; end < maxEnd; end += 1) {
    const agentEvent = events[end];
    if (agentEvent === undefined) {
      throw new RangeError("Event batch must contain defined events");
    }
    const event = serializeEventStreamValue(agentEvent);
    // 单事件不可拆分；先交付已有合法前缀，下次遇到超限事件时转为快照恢复。
    if (event.byteLength > MAX_AGENT_EVENT_BYTES) {
      if (end === offset) return undefined;
      break;
    }
    const nextByteLength = byteLength + event.byteLength + (end === offset ? 0 : 1);
    if (nextByteLength > MAX_EVENT_BATCH_BYTES) break;
    byteLength = nextByteLength;
    serializedEvents.push(event);
  }
  const firstEvent = events[offset];
  if (firstEvent === undefined) {
    throw new RangeError("Event batch must contain at least one event");
  }
  const eventCount = end - offset;
  const cachedByCount = serializedEventBatches.get(firstEvent);
  const cached = cachedByCount?.get(eventCount);
  if (cached !== undefined && hasSameEvents(cached.events, events, offset, end)) {
    return cached;
  }

  const batchEvents = events.slice(offset, end);
  // 复用单事件 JSON 和字节长度；预算包含协议封套与逗号，不重复遍历正文。
  const data = `${EVENT_BATCH_PREFIX}${serializedEvents.map((event) => event.data).join(",")}${EVENT_BATCH_SUFFIX}`;
  const message = { byteLength, data };
  const batch = { events: batchEvents, message };

  const batches = cachedByCount ?? new Map<number, SerializedEventBatch>();
  batches.set(eventCount, batch);
  if (cachedByCount === undefined) {
    // 缓存生命周期绑定首事件，同一批次可供全部页面连接复用且不会形成全局常驻表。
    serializedEventBatches.set(firstEvent, batches);
  }
  return batch;
}

function sendSerializedEventStreamMessage(
  socket: EventStreamSocket,
  serialize: () => SerializedEventStreamMessage | undefined,
  onSoftBackpressure: () => void,
  onSlowClientDisconnect: () => void,
): boolean {
  if (socket.readyState !== 1) {
    return false;
  }
  if (socket.bufferedAmount > EVENT_SOCKET_HARD_BACKPRESSURE_BYTES) {
    // 硬上限必须在序列化和 send 前断开，避免慢客户端继续扩大进程内缓冲。
    onSlowClientDisconnect();
    socket.close(1013, "Client is too slow; refresh the snapshot");
    return false;
  }
  const message = serialize();
  if (message === undefined || message.byteLength > MAX_EVENT_BATCH_BYTES) {
    // 内容过大与慢客户端分开处理；客户端收到 1009 后读取快照，不反复重连同一事件。
    socket.close(1009, "Event frame is too large; refresh the snapshot");
    return false;
  }
  const projectedBufferedAmount = socket.bufferedAmount + message.byteLength;
  if (projectedBufferedAmount > EVENT_SOCKET_HARD_BACKPRESSURE_BYTES) {
    onSlowClientDisconnect();
    socket.close(1013, "Client is too slow; refresh the snapshot");
    return false;
  }
  if (projectedBufferedAmount > EVENT_SOCKET_SOFT_BACKPRESSURE_BYTES) {
    onSoftBackpressure();
  }
  socket.send(message.data);
  return true;
}

export function sendEventStreamMessage(
  socket: EventStreamSocket,
  message: EventStreamMessage,
  onSoftBackpressure: () => void,
  onSlowClientDisconnect: () => void,
): boolean {
  return sendSerializedEventStreamMessage(
    socket,
    () => {
      // 通用消息入口同样执行单事件预算，防止直接发送 EventBatch 绕过分批路径。
      if (
        message.type === "events.batch" &&
        message.events.some(
          (event) => getSerializedAgentEventByteLength(event) > MAX_AGENT_EVENT_BYTES,
        )
      )
        return undefined;
      return serializeEventStreamMessage(message);
    },
    onSoftBackpressure,
    onSlowClientDisconnect,
  );
}

export function sendEventStreamEvents(
  socket: EventStreamSocket,
  events: readonly AgentEvent[],
  onSoftBackpressure: () => void,
  onSlowClientDisconnect: () => void,
): boolean {
  for (let offset = 0; offset < events.length;) {
    let nextOffset = offset;
    if (
      !sendSerializedEventStreamMessage(
        socket,
        () => {
          const batch = serializeEventBatch(events, offset);
          if (batch === undefined) return undefined;
          nextOffset += batch.events.length;
          return batch.message;
        },
        onSoftBackpressure,
        onSlowClientDisconnect,
      )
    ) {
      return false;
    }
    offset = nextOffset;
  }
  return true;
}
