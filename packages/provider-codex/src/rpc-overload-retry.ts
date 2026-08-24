const DEFAULT_BASE_DELAY_MS = 100;
const DEFAULT_MAX_DELAY_MS = 2_000;
const DEFAULT_MAX_ELAPSED_MS = 5_000;
const DEFAULT_MAX_RETRIES = 4;

export interface RpcOverloadRetryOptions {
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly maxElapsedMs?: number;
  readonly maxRetries?: number;
  readonly random?: () => number;
}

export interface RpcOverloadRetryPolicy {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly maxElapsedMs: number;
  readonly maxRetries: number;
  readonly random: () => number;
}

export function validatePositiveSafeInteger(value: number, optionName: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${optionName} must be a positive safe integer`);
  }
  return value;
}

function validateNonNegativeSafeInteger(value: number, optionName: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${optionName} must be a non-negative safe integer`);
  }
  return value;
}

export function createRpcOverloadRetryPolicy(
  options: RpcOverloadRetryOptions = {},
): RpcOverloadRetryPolicy {
  return {
    baseDelayMs: validatePositiveSafeInteger(
      options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
      "overloadRetry.baseDelayMs",
    ),
    maxDelayMs: validatePositiveSafeInteger(
      options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
      "overloadRetry.maxDelayMs",
    ),
    maxElapsedMs: validatePositiveSafeInteger(
      options.maxElapsedMs ?? DEFAULT_MAX_ELAPSED_MS,
      "overloadRetry.maxElapsedMs",
    ),
    maxRetries: validateNonNegativeSafeInteger(
      options.maxRetries ?? DEFAULT_MAX_RETRIES,
      "overloadRetry.maxRetries",
    ),
    random: options.random ?? Math.random,
  };
}

export function isExplicitlyUnqueuedOverload(error: {
  readonly code: number;
  readonly data: unknown;
}): boolean {
  return (
    error.code === -32001 &&
    typeof error.data === "object" &&
    error.data !== null &&
    !Array.isArray(error.data) &&
    (error.data as Record<string, unknown>)["retry"] === true
  );
}

export function calculateOverloadRetryDelay(
  policy: RpcOverloadRetryPolicy,
  retryCount: number,
  elapsedMs: number,
): number | null {
  if (retryCount >= policy.maxRetries || elapsedMs >= policy.maxElapsedMs) {
    return null;
  }

  const exponentialDelay = Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * 2 ** Math.min(retryCount, 30),
  );
  const sample = policy.random();
  const boundedSample = Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0.5;
  // 使用正负 20% 抖动，并在抖动后再次限制单次和累计等待时间。
  const jitteredDelay = Math.min(
    policy.maxDelayMs,
    Math.max(1, Math.round(exponentialDelay * (0.8 + boundedSample * 0.4))),
  );
  return elapsedMs + jitteredDelay <= policy.maxElapsedMs ? jitteredDelay : null;
}
