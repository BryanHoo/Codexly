import {
  CodexProtocolMappingError,
  CodexProviderConnectionError,
  RpcConnectionClosedError,
  RpcProtocolError,
  RpcResponseError,
  RpcTimeoutError,
} from "@codexly/provider-codex";

import { MutationHttpError, type RunIdempotent } from "./routes/context.js";
import { fingerprintPayload } from "./server-runtime.js";
import { originalErrorMessage } from "./error-message.js";

function codexErrorMessage(error: unknown): string | undefined {
  if (
    error instanceof CodexProtocolMappingError ||
    error instanceof CodexProviderConnectionError ||
    error instanceof RpcConnectionClosedError ||
    error instanceof RpcProtocolError ||
    error instanceof RpcResponseError ||
    error instanceof RpcTimeoutError
  ) {
    return originalErrorMessage(error, "Agent provider request failed");
  }
  return undefined;
}

type CompletedIdempotencyEntry = Readonly<{
  expiresAt: number;
  fingerprint: string;
  result: unknown;
}>;

type InFlightIdempotencyEntry = Readonly<{
  fingerprint: string;
  promise: Promise<unknown>;
}>;

export function createIdempotencyRunner(
  cacheSize: number,
  ttlMs: number,
): Readonly<{
  clear: () => void;
  run: RunIdempotent;
}> {
  if (!Number.isInteger(cacheSize) || cacheSize <= 0) {
    throw new RangeError("Idempotency cache size must be a positive integer");
  }
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new RangeError("Idempotency TTL must be a positive number");
  }

  // 已完成结果受 TTL/缓存容量约束，进行中请求使用独立硬上限。
  const completedEntries = new Map<string, CompletedIdempotencyEntry>();
  const inFlightEntries = new Map<string, InFlightIdempotencyEntry>();
  const assertFingerprint = (entryFingerprint: string, fingerprint: string) => {
    if (entryFingerprint !== fingerprint) {
      throw new MutationHttpError(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was already used with another request",
        409,
      );
    }
  };
  const pruneCompletedEntries = () => {
    const now = Date.now();
    for (const [entryKey, entry] of completedEntries) {
      if (entry.expiresAt <= now) {
        completedEntries.delete(entryKey);
      }
    }
    for (const entryKey of completedEntries.keys()) {
      if (completedEntries.size <= cacheSize) {
        break;
      }
      completedEntries.delete(entryKey);
    }
  };
  const run: RunIdempotent = async <T>(
    scope: readonly string[],
    key: string,
    payload: unknown,
    action: () => Promise<T> | T,
  ): Promise<T> => {
    pruneCompletedEntries();
    // 结构化编码完整资源作用域，避免跨 Project 命中或分隔符碰撞。
    const entryKey = JSON.stringify([...scope, key]);
    const fingerprint = fingerprintPayload(payload);
    const inFlightEntry = inFlightEntries.get(entryKey);
    if (inFlightEntry !== undefined) {
      assertFingerprint(inFlightEntry.fingerprint, fingerprint);
      return inFlightEntry.promise as Promise<T>;
    }
    const completedEntry = completedEntries.get(entryKey);
    if (completedEntry !== undefined) {
      assertFingerprint(completedEntry.fingerprint, fingerprint);
      return completedEntry.result as T;
    }
    if (inFlightEntries.size >= cacheSize) {
      throw new MutationHttpError(
        "IDEMPOTENCY_CAPACITY_EXCEEDED",
        "Too many idempotent requests are in progress",
        503,
        true,
      );
    }

    const promise: Promise<T> = Promise.resolve()
      .then(() => {
        return action();
      })
      .catch((error: unknown) => {
        if (error instanceof MutationHttpError) {
          throw error;
        }
        throw new MutationHttpError(
          "PROVIDER_ERROR",
          codexErrorMessage(error) ?? "Agent provider request failed",
          502,
          true,
        );
      });
    const entry: InFlightIdempotencyEntry = { fingerprint, promise };
    inFlightEntries.set(entryKey, entry);
    try {
      const result = await promise;
      // 关闭流程可能已清空 Entry，只缓存仍由当前实例管理的结果。
      if (inFlightEntries.get(entryKey) === entry) {
        inFlightEntries.delete(entryKey);
        completedEntries.set(entryKey, {
          expiresAt: Date.now() + ttlMs,
          fingerprint,
          result,
        });
        pruneCompletedEntries();
      }
      return result;
    } catch (error) {
      // 失败结果不进入幂等缓存，允许调用方使用同一 Key 安全重试。
      if (inFlightEntries.get(entryKey) === entry) {
        inFlightEntries.delete(entryKey);
      }
      throw error;
    }
  };

  return {
    clear() {
      completedEntries.clear();
      inFlightEntries.clear();
    },
    run,
  };
}
