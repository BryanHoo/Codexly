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
