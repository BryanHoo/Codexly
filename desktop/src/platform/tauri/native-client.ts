import { ensureCodexRuntime, subscribeAgentEvents } from "./runtime.js";
import { invoke, type NativeInvoke } from "./native-invoke.js";

export type InvokeImplementation = NativeInvoke;

export type TauriClientOptions = Readonly<{
  ensureRuntime?: () => Promise<unknown>;
  invoke?: InvokeImplementation;
  subscribeAgentEvents?: typeof subscribeAgentEvents;
}>;

export class NativeCommandError extends Error {
  public readonly code: string;
  public readonly rpcCode: number | null;

  public constructor(code: string, message: string, rpcCode: number | null = null) {
    super(message);
    this.name = "NativeCommandError";
    this.code = code;
    this.rpcCode = rpcCode;
  }
}

export function normalizeNativeError(error: unknown): unknown {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    const rpcCode = "rpcCode" in error && typeof error.rpcCode === "number" ? error.rpcCode : null;
    return new NativeCommandError(error.code, error.message, rpcCode);
  }
  // Tauri 参数校验等框架错误以字符串拒绝，统一包装后保留原始诊断信息。
  if (typeof error === "string" && error.trim().length > 0) return new Error(error);
  return error;
}

export class TauriNativeClient {
  protected readonly ensureRuntime: () => Promise<unknown>;
  protected readonly invokeNative: InvokeImplementation;
  protected readonly subscribeNativeEvents: typeof subscribeAgentEvents;
  protected readonly taskProjects = new Map<string, string>();

  public constructor(options: TauriClientOptions = {}) {
    this.ensureRuntime = options.ensureRuntime ?? ensureCodexRuntime;
    this.invokeNative = options.invoke ?? invoke;
    this.subscribeNativeEvents = options.subscribeAgentEvents ?? subscribeAgentEvents;
  }

  protected async call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    await this.ensureRuntime();
    return this.invokeCommand(command, args);
  }

  protected async callRaw<T>(
    command: string,
    body: Uint8Array,
    headers: Record<string, string>,
  ): Promise<T> {
    await this.ensureRuntime();
    try {
      return await this.invokeNative<T>(command, body, { headers });
    } catch (error) {
      throw normalizeNativeError(error);
    }
  }

  protected async callCancellable<T>(
    command: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal === undefined) return this.call(command, args);

    signal.throwIfAborted();
    await this.ensureRuntime();
    signal.throwIfAborted();
    const requestId = crypto.randomUUID();
    let rejectCancellation: ((reason?: unknown) => void) | undefined;
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    const cancelRequest = () => {
      // 取消命令绕过运行时初始化，确保 AbortSignal 能立即到达已运行的 Rust 任务。
      void this.invokeNative("cancel_native_request", { requestId }).catch(() => undefined);
      rejectCancellation?.(signal.reason);
    };
    signal.addEventListener("abort", cancelRequest, { once: true });
    try {
      const request = this.invokeCommand<T>(command, { ...args, requestId });
      return await Promise.race([request, cancellation]);
    } finally {
      signal.removeEventListener("abort", cancelRequest);
    }
  }

  protected async invokeCommand<T>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T> {
    try {
      return args === undefined
        ? await this.invokeNative<T>(command)
        : await this.invokeNative<T>(command, args);
    } catch (error) {
      throw normalizeNativeError(error);
    }
  }
}
