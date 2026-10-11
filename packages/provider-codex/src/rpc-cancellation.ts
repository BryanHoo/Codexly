import type { AgentCancellationSignal } from "@codexly/core";

export function createRpcAbortError(): Error {
  const error = new Error("RPC request cancelled");
  error.name = "AbortError";
  return error;
}

export function throwIfRpcAborted(signal: AgentCancellationSignal | undefined): void {
  if (signal?.aborted === true) throw createRpcAbortError();
}
