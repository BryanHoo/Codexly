import { Channel } from "@tauri-apps/api/core";
import type { AgentEvent, ResyncRequired } from "@/protocol/index.js";
import {
  applicationPerformanceMetrics,
  PERFORMANCE_MONITORING_ENABLED,
} from "@/shared/performance/performance-metrics.js";

import { invoke } from "./native-invoke.js";
import { RuntimeEventHistory, type ReplayGap } from "./runtime-event-history.js";
import { createRuntimeEventAcknowledger, type RuntimeDelivery } from "./runtime-event-ack.js";

export type RuntimeStatus = "failed" | "idle" | "ready" | "starting";
export type RuntimeSnapshot = Readonly<{
  lastSeq: number;
  provider: "codex" | null;
  status: RuntimeStatus;
}>;

type RuntimeStatusEvent = Readonly<{
  data: Readonly<{ provider: "codex" | null; seq: number; status: RuntimeStatus }>;
  type: "runtimeStatus";
}>;

type AgentRuntimeEvent = Readonly<{
  data: Readonly<{ event: AgentEvent }>;
  type: "agentEvent";
}>;

export type NativeResyncRequired = ResyncRequired & Readonly<{ projectId: string }>;

type ResyncRequiredRuntimeEvent = Readonly<{
  data: NativeResyncRequired;
  type: "resyncRequired";
}>;

type RuntimeEvent = (AgentRuntimeEvent | ResyncRequiredRuntimeEvent | RuntimeStatusEvent) &
  Readonly<{ enqueuedAtUnixMs?: number }>;
export type AgentEventSubscription = Readonly<{
  afterSequence: number;
  onEvent: (event: AgentEvent) => void;
  onReplayGap?: (gap: ReplayGap) => void;
  onResyncRequired?: (message: NativeResyncRequired) => void;
}>;

let connectionPromise: Promise<RuntimeSnapshot> | undefined;
const runtimeListeners = new Set<(event: RuntimeStatusEvent) => void>();
const agentEventSubscriptions = new Set<AgentEventSubscription>();
const recentAgentEvents = new RuntimeEventHistory();

export function subscribeRuntime(listener: (event: RuntimeStatusEvent) => void): () => void {
  runtimeListeners.add(listener);
  return () => runtimeListeners.delete(listener);
}

export function subscribeAgentEvents(options: AgentEventSubscription): () => void {
  agentEventSubscriptions.add(options);
  // Channel 在页面订阅前已经可能收到事件，按 checkpoint 回放避免首帧丢失。
  recentAgentEvents.replay(options.afterSequence, options.onEvent, options.onReplayGap);
  return () => agentEventSubscriptions.delete(options);
}

export function connectAcpEvents(): Promise<RuntimeSnapshot> {
  connectionPromise ??= (async () => {
    const acknowledge = createRuntimeEventAcknowledger();
    const consume = (event: RuntimeEvent) => {
      if (event.type === "runtimeStatus") {
        connectionPromise = event.data.status === "failed"
          ? undefined
          : Promise.resolve({
              lastSeq: event.data.seq,
              provider: event.data.provider,
              status: event.data.status,
            });
        for (const listener of runtimeListeners) listener(event);
        return;
      }
      if (event.type === "resyncRequired") {
        for (const subscription of agentEventSubscriptions) {
          subscription.onResyncRequired?.(event.data);
        }
        return;
      }
      recentAgentEvents.append(event.data.event);
      if (PERFORMANCE_MONITORING_ENABLED) {
        applicationPerformanceMetrics.recordIpcEvent(recentAgentEvents.size, performance.now());
      }
      for (const subscription of agentEventSubscriptions) subscription.onEvent(event.data.event);
    };
    const channel = new Channel<RuntimeEvent & RuntimeDelivery>((event) => {
      if (PERFORMANCE_MONITORING_ENABLED && event.enqueuedAtUnixMs !== undefined) {
        // 在订阅者处理前取样，测量原生入队至 WebView 回调的传输延迟。
        applicationPerformanceMetrics.recordEnqueueToWebView(event.enqueuedAtUnixMs, Date.now());
      }
      consume(event);
      acknowledge(event);
    });
    return invoke<RuntimeSnapshot>("connect_runtime", { onEvent: channel });
  })().catch((error: unknown) => {
    connectionPromise = undefined;
    throw error;
  });
  return connectionPromise;
}
