export interface RpcErrorPayload {
  code: number;
  data: unknown;
  message: string;
}

export class RpcConnectionClosedError extends Error {
  public constructor(message = "RPC connection is closed") {
    super(message);
    this.name = "RpcConnectionClosedError";
  }
}

export class RpcProtocolError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RpcProtocolError";
  }
}

/** 本地准入失败表示帧尚未交付，可由调用方稍后重试，不等同于连接故障。 */
export class RpcWriteQueueFullError extends Error {
  public constructor(message = "RPC outbound queue budget exceeded") {
    super(message);
    this.name = "RpcWriteQueueFullError";
  }
}

export class RpcResponseError extends Error {
  public readonly code: number;
  public readonly data: unknown;

  public constructor(error: RpcErrorPayload) {
    super(error.message);
    this.name = "RpcResponseError";
    this.code = error.code;
    this.data = error.data;
  }
}

export class RpcTimeoutError extends Error {
  public readonly method: string;
  public readonly requestId: number;
  public readonly timeoutMs: number;

  public constructor(requestId: number, method: string, timeoutMs: number) {
    super(`RPC request ${method} (${String(requestId)}) timed out after ${String(timeoutMs)}ms`);
    this.name = "RpcTimeoutError";
    this.method = method;
    this.requestId = requestId;
    this.timeoutMs = timeoutMs;
  }
}
