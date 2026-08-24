import { calculateOverloadRetryDelay, type RpcOverloadRetryPolicy } from "./rpc-overload-retry.js";

interface RpcPendingRequestOptions {
  readonly onTimeout: () => void;
  readonly reject: (error: Error) => void;
  readonly request: unknown;
  readonly resolve: (result: unknown) => void;
  readonly timeoutMs: number;
}

export class RpcPendingRequest {
  public readonly request: unknown;

  readonly #reject: (error: Error) => void;
  readonly #resolve: (result: unknown) => void;
  readonly #startedAt = Date.now();
  readonly #timeoutTimer: NodeJS.Timeout;
  #retryCount = 0;
  #retryTimer: NodeJS.Timeout | undefined;

  public constructor(options: RpcPendingRequestOptions) {
    this.request = options.request;
    this.#reject = options.reject;
    this.#resolve = options.resolve;
    this.#timeoutTimer = setTimeout(options.onTimeout, options.timeoutMs);
    this.#timeoutTimer.unref();
  }

  public scheduleOverloadRetry(policy: RpcOverloadRetryPolicy, resend: () => void): boolean {
    if (this.#retryTimer !== undefined) {
      return true;
    }
    const delayMs = calculateOverloadRetryDelay(
      policy,
      this.#retryCount,
      Date.now() - this.#startedAt,
    );
    if (delayMs === null) {
      return false;
    }

    this.#retryCount += 1;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined;
      resend();
    }, delayMs);
    this.#retryTimer.unref();
    return true;
  }

  public reject(error: Error): void {
    this.clearTimers();
    this.#reject(error);
  }

  public resolve(result: unknown): void {
    this.clearTimers();
    this.#resolve(result);
  }

  public clearTimers(): void {
    clearTimeout(this.#timeoutTimer);
    if (this.#retryTimer !== undefined) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = undefined;
    }
  }
}
