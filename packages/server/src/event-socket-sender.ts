import { Buffer } from "node:buffer";

import {
  MAX_EVENT_BATCH_SIZE,
  type AgentEvent,
  type EventBatch,
  type EventStreamMessage,
} from "@code-agent/protocol";

const EVENT_SOCKET_SOFT_BACKPRESSURE_BYTES = 256 * 1_024;
const EVENT_SOCKET_HARD_BACKPRESSURE_BYTES = 1_024 * 1_024;
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
): SerializedEventStreamMessage {
  const end = Math.min(offset + MAX_EVENT_BATCH_SIZE, events.length);
  const firstEvent = events[offset];
  if (firstEvent === undefined) {
    throw new RangeError("Event batch must contain at least one event");
  }
  const eventCount = end - offset;
  const cachedByCount = serializedEventBatches.get(firstEvent);
  const cached = cachedByCount?.get(eventCount);
  if (cached !== undefined && hasSameEvents(cached.events, events, offset, end)) {
    return cached.message;
  }

  const batchEvents = events.slice(offset, end);
  const serializedEvents = batchEvents.map((event) => serializedMessages.get(event));
  let message: SerializedEventStreamMessage;
  if (serializedEvents.every((event) => event !== undefined)) {
    // 保留阶段已有事件 JSON 时直接组装协议帧，避免再次遍历大 diff。
    const data = `{"events":[${serializedEvents.map((event) => event.data).join(",")}],"type":"events.batch","version":3}`;
    message = { byteLength: Buffer.byteLength(data), data };
  } else {
    const batch: EventBatch = { events: batchEvents, type: "events.batch", version: 3 };
    message = serializeEventStreamValue(batch);
  }

  const batches = cachedByCount ?? new Map<number, SerializedEventBatch>();
  batches.set(eventCount, { events: batchEvents, message });
  if (cachedByCount === undefined) {
    // 缓存生命周期绑定首事件，同一批次可供全部页面连接复用且不会形成全局常驻表。
    serializedEventBatches.set(firstEvent, batches);
  }
  return message;
}

function sendSerializedEventStreamMessage(
  socket: EventStreamSocket,
  serialize: () => SerializedEventStreamMessage,
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
  if (socket.bufferedAmount > EVENT_SOCKET_SOFT_BACKPRESSURE_BYTES) {
    onSoftBackpressure();
  }
  socket.send(serialize().data);
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
    () => serializeEventStreamMessage(message),
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
  for (let offset = 0; offset < events.length; offset += MAX_EVENT_BATCH_SIZE) {
    if (
      !sendSerializedEventStreamMessage(
        socket,
        () => serializeEventBatch(events, offset),
        onSoftBackpressure,
        onSlowClientDisconnect,
      )
    ) {
      return false;
    }
  }
  return true;
}
