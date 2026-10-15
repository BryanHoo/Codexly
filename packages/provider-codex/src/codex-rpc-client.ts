import type { AgentCancellationSignal, LocalTask } from "@codexly/core";

import type { RpcErrorPayload, RpcRequestId, RpcServerRequest } from "./jsonl-rpc-client.js";

export interface CodexRpcClient {
  readLocalTask?(taskId: string): Promise<LocalTask | null>;
  nativeTaskId?(taskId: string): string;
  notify(method: string, params?: unknown): void;
  onNotification(listener: (notification: { method: string; params: unknown }) => void): () => void;
  onServerRequest(listener: (request: RpcServerRequest) => void): () => void;
  rejectServerRequest(id: RpcRequestId, error: RpcErrorPayload): Promise<void>;
  request(
    method: string,
    params?: unknown,
    timeoutMs?: number,
    signal?: AgentCancellationSignal,
  ): Promise<unknown>;
  respondToServerRequest(id: RpcRequestId, result: unknown): Promise<void> | void;
}
