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

type RuntimeEvent = AgentRuntimeEvent | ResyncRequiredRuntimeEvent | RuntimeStatusEvent;
export type AgentEventSubscription = Readonly<{
  afterSequence: number;
  onEvent: (event: AgentEvent) => void;
  onReplayGap?: (gap: ReplayGap) => void;
  onResyncRequired?: (message: NativeResyncRequired) => void;
}>;

let runtimePromise: Promise<RuntimeSnapshot> | undefined;
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

export function ensureCodexRuntime(): Promise<RuntimeSnapshot> {
  runtimePromise ??= (async () => {
    const snapshot = await connectCodexRuntime();
    // WebView 重建只需恢复事件通道；后台进程就绪时不再执行启动命令。
    return snapshot.status === "ready" ? snapshot : invoke<RuntimeSnapshot>("start_runtime");
  })().catch((error: unknown) => {
    runtimePromise = undefined;
    throw error;
  });
  return runtimePromise;
}

export function connectCodexRuntime(): Promise<RuntimeSnapshot> {
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
        // 后端进程已失效时清除已兑现 Promise，让下一次命令重新握手。
        if (event.data.status === "failed") runtimePromise = undefined;
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
