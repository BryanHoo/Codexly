import type { RpcErrorPayload } from "./jsonl-rpc-errors.js";
import type { JsonlRpcClientOptions } from "./jsonl-rpc-types.js";
import { validatePositiveSafeInteger } from "./rpc-overload-retry.js";

export function getRpcFrameLimits(options: JsonlRpcClientOptions) {
  // 50 MiB 图片经 Base64 编码约为 67 MiB，为文本和协议字段预留空间。
  const maxJsonlBytes = 80 * 1024 * 1024;
  return {
    largeFrameThresholdBytes: validatePositiveSafeInteger(
      options.largeFrameThresholdBytes ?? 1024 * 1024,
      "largeFrameThresholdBytes",
    ),
    maxFrameBytes: validatePositiveSafeInteger(
      options.maxFrameBytes ?? maxJsonlBytes,
      "maxFrameBytes",
    ),
    maxBufferBytes: validatePositiveSafeInteger(
      options.maxBufferBytes ?? maxJsonlBytes,
      "maxBufferBytes",
    ),
  };
}

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
