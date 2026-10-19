import type { Readable, Writable } from "node:stream";

import type { RpcOverloadRetryOptions } from "./rpc-overload-retry.js";

export interface JsonlRpcClientOptions {
  input: Readable;
  output: Writable;
  defaultTimeoutMs?: number;
  closeOnInputEnd?: boolean;
  largeFrameThresholdBytes?: number;
  maxFrameBytes?: number;
  maxBufferBytes?: number;
  /** 出站待交付及写回调未完成帧的总字节上限，默认 80 MiB，兼容现有图片上传。 */
  maxWriteBufferBytes?: number;
  /** 等待响应的逻辑请求上限，默认 128；服务端过载重试沿用同一槽位。 */
  maxPendingRequests?: number;
  /** 请求、通知与服务端响应共用的未完成写入数上限，默认 128。 */
  maxPendingWrites?: number;
  overloadRetry?: RpcOverloadRetryOptions;
  workerUrl?: URL;
}

export interface RpcNotification {
  method: string;
  params: unknown;
}

export type RpcRequestId = string | number;

export interface RpcServerRequest {
  id: RpcRequestId;
  method: string;
  params: unknown;
}
