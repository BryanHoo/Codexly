import type { Writable } from "node:stream";

import { RpcConnectionClosedError, type RpcErrorPayload } from "./jsonl-rpc-errors.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRequestId(value: unknown): value is string | number {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

export function parseRpcError(value: unknown): RpcErrorPayload | null {
  if (!isRecord(value) || typeof value["code"] !== "number" || typeof value["message"] !== "string")
    return null;
  return { code: value["code"], data: value["data"], message: value["message"] };
}

export function writeRpcMessage(
  output: Writable,
  message: unknown,
  timeoutMs: number,
): Promise<void> {
  const frame = `${JSON.stringify(message)}\n`;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new RpcConnectionClosedError(`RPC write timed out after ${String(timeoutMs)}ms`));
    }, timeoutMs);
    timer.unref();
    output.write(frame, "utf8", (error) => {
      clearTimeout(timer);
      if (error) {
        reject(new RpcConnectionClosedError(`RPC write failed: ${error.message}`));
        return;
      }
      resolve();
    });
  });
}
