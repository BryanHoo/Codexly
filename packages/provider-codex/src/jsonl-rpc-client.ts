import type { Readable, Writable } from "node:stream";

import { JsonlChunkBuffer } from "./jsonl-chunk-buffer.js";
import { JsonlFrameParseError, JsonlFrameProcessor } from "./jsonl-frame-processor.js";
import {
  RpcConnectionClosedError,
  RpcProtocolError,
  RpcResponseError,
  RpcTimeoutError,
  type RpcErrorPayload,
} from "./jsonl-rpc-errors.js";
import { isRecord, isRequestId, parseRpcError, writeRpcMessage } from "./jsonl-rpc-helpers.js";
import {
  createRpcOverloadRetryPolicy,
  isExplicitlyUnqueuedOverload,
  type RpcOverloadRetryOptions,
  type RpcOverloadRetryPolicy,
  validatePositiveSafeInteger,
} from "./rpc-overload-retry.js";
import { RpcPendingRequest } from "./rpc-pending-request.js";

// 原生 imageGeneration 会把图片 Base64 放进单个 JSONL 帧，64 MiB 可覆盖最大图片并保留协议边界。
const DEFAULT_MAX_JSONL_BYTES = 64 * 1_024 * 1_024;
const DEFAULT_LARGE_FRAME_THRESHOLD_BYTES = 1 * 1_024 * 1_024;

export {
  RpcConnectionClosedError,
  RpcProtocolError,
  RpcResponseError,
  RpcTimeoutError,
} from "./jsonl-rpc-errors.js";
export type { RpcErrorPayload } from "./jsonl-rpc-errors.js";

export interface JsonlRpcClientOptions {
  input: Readable;
  output: Writable;
  defaultTimeoutMs?: number;
  closeOnInputEnd?: boolean;
  largeFrameThresholdBytes?: number;
  maxFrameBytes?: number;
  maxBufferBytes?: number;
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

type NotificationListener = (notification: RpcNotification) => void;
type ErrorListener = (error: Error) => void;
type ServerRequestListener = (request: RpcServerRequest) => void;

export class JsonlRpcClient {
  readonly #defaultTimeoutMs: number;
  readonly #closeOnInputEnd: boolean;
  readonly #errorListeners = new Set<ErrorListener>();
  readonly #input: Readable;
  readonly #largeFrameThresholdBytes: number;
  readonly #maxBufferBytes: number;
  readonly #maxFrameBytes: number;
  readonly #notificationListeners = new Set<NotificationListener>();
  readonly #output: Writable;
  readonly #overloadRetryPolicy: RpcOverloadRetryPolicy;
  readonly #pending = new Map<number, RpcPendingRequest>();
  readonly #serverRequestListeners = new Set<ServerRequestListener>();
  readonly #workerUrl: URL | undefined;
  readonly #frameBuffer = new JsonlChunkBuffer();
  #closed = false;
  #frameProcessor: JsonlFrameProcessor | undefined;
  #frameQueue = Promise.resolve();
  #inputEnded = false;
  #nextRequestId = 1;
  #queuedFrameCount = 0;

  public constructor(options: JsonlRpcClientOptions) {
    this.#input = options.input;
    this.#output = options.output;
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
    this.#closeOnInputEnd = options.closeOnInputEnd ?? true;
    this.#largeFrameThresholdBytes = validatePositiveSafeInteger(
      options.largeFrameThresholdBytes ?? DEFAULT_LARGE_FRAME_THRESHOLD_BYTES,
      "largeFrameThresholdBytes",
    );
    this.#maxFrameBytes = validatePositiveSafeInteger(
      options.maxFrameBytes ?? DEFAULT_MAX_JSONL_BYTES,
      "maxFrameBytes",
    );
    this.#maxBufferBytes = validatePositiveSafeInteger(
      options.maxBufferBytes ?? DEFAULT_MAX_JSONL_BYTES,
      "maxBufferBytes",
    );
    this.#overloadRetryPolicy = createRpcOverloadRetryPolicy(options.overloadRetry);
    this.#workerUrl = options.workerUrl;

    this.#input.on("data", this.#handleData);
    this.#input.on("end", this.#handleInputEnd);
    this.#input.on("error", this.#handleStreamError);
    this.#output.on("error", this.#handleStreamError);
  }

  public get closed(): boolean {
    return this.#closed;
  }

  public request(
    method: string,
    params?: unknown,
    timeoutMs = this.#defaultTimeoutMs,
  ): Promise<unknown> {
    this.#assertOpen();
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new RangeError("RPC timeout must be a positive finite number");
    }

    const id = this.#nextRequestId++;
    const request = params === undefined ? { id, method } : { id, method, params };

    return new Promise<unknown>((resolve, reject) => {
      const pending = new RpcPendingRequest({
        onTimeout: () => {
          if (this.#removePending(id, pending)) {
            pending.reject(new RpcTimeoutError(id, method, timeoutMs));
          }
        },
        reject,
        request,
        resolve,
        timeoutMs,
      });
      this.#pending.set(id, pending);

      try {
        void this.#sendMessage(request).catch(() => undefined);
      } catch {
        // #sendMessage 已关闭连接并拒绝当前 Pending RPC。
      }
    });
  }

  public notify(method: string, params?: unknown): void {
    const notification = params === undefined ? { method } : { method, params };
    void this.#sendMessage(notification).catch(() => undefined);
  }

  public onNotification(listener: NotificationListener): () => void {
    this.#notificationListeners.add(listener);
    return () => {
      this.#notificationListeners.delete(listener);
    };
  }

  public onError(listener: ErrorListener): () => void {
    this.#errorListeners.add(listener);
    return () => {
      this.#errorListeners.delete(listener);
    };
  }

  public onServerRequest(listener: ServerRequestListener): () => void {
    this.#serverRequestListeners.add(listener);
    return () => {
      this.#serverRequestListeners.delete(listener);
    };
  }

  public respondToServerRequest(id: RpcRequestId, result: unknown): Promise<void> {
    if (!isRequestId(id)) {
      throw new TypeError("RPC request id must be a string or finite number");
    }
    return this.#sendMessage({ id, result });
  }

  public rejectServerRequest(id: RpcRequestId, error: RpcErrorPayload): Promise<void> {
    if (!isRequestId(id)) {
      throw new TypeError("RPC request id must be a string or finite number");
    }
    return this.#sendMessage({ error, id });
  }

  #sendMessage(message: unknown): Promise<void> {
    this.#assertOpen();
    let pendingWrite: Promise<void>;
    try {
      pendingWrite = writeRpcMessage(this.#output, message, this.#defaultTimeoutMs);
    } catch (error) {
      const connectionError = this.#toConnectionError(error);
      this.#fail(connectionError);
      throw connectionError;
    }
    return pendingWrite.catch((error: unknown) => {
      const connectionError = this.#toConnectionError(error);
      this.#fail(connectionError);
      throw connectionError;
    });
  }

  public close(reason: Error = new RpcConnectionClosedError()): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;

    this.#input.off("data", this.#handleData);
    this.#input.off("end", this.#handleInputEnd);
    this.#input.off("error", this.#handleStreamError);
    this.#output.off("error", this.#handleStreamError);

    for (const pending of this.#pending.values()) {
      pending.reject(reason);
    }
    this.#pending.clear();
    this.#frameBuffer.clear();
    this.#frameProcessor?.dispose();
    this.#notificationListeners.clear();
    this.#serverRequestListeners.clear();
    this.#errorListeners.clear();
  }

  readonly #handleData = (chunk: Buffer | string): void => {
    const input = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    let frameStart = 0;
    let newlineIndex = input.indexOf(0x0a, frameStart);
    while (newlineIndex >= 0) {
      const chunkFrame = input.subarray(frameStart, newlineIndex);
      const endsWithCarriageReturn =
        chunkFrame.at(-1) === 0x0d ||
        (chunkFrame.length === 0 && this.#frameBuffer.lastByte === 0x0d);
      const frameBytes =
        this.#frameBuffer.byteLength + chunkFrame.length - (endsWithCarriageReturn ? 1 : 0);
      if (frameBytes > this.#maxFrameBytes) {
        this.#failOversizedFrame(frameBytes);
        return;
      }

      // 仅在帧跨 chunk 时拼接，完整 burst 内的帧直接使用原 Buffer 视图。
      let frame = this.#frameBuffer.takeFrame(chunkFrame);
      if (endsWithCarriageReturn) {
        frame = frame.subarray(0, -1);
      }
      if (!this.#handleFrame(frame)) {
        return;
      }
      frameStart = newlineIndex + 1;
      newlineIndex = input.indexOf(0x0a, frameStart);
    }

    const remainder = input.subarray(frameStart);
    const bufferedBytes = this.#frameBuffer.byteLength + remainder.length;
    if (bufferedBytes > this.#maxBufferBytes) {
      this.#fail(
        new RpcProtocolError(
          `RPC unfinished JSONL buffer exceeds ${String(this.#maxBufferBytes)} bytes (${String(bufferedBytes)} bytes)`,
        ),
      );
      return;
    }
    if (bufferedBytes > this.#maxFrameBytes) {
      this.#failOversizedFrame(bufferedBytes);
      return;
    }
    if (remainder.length > 0) {
      // 保留原始字节可精确计数，并自然覆盖跨 chunk 的 UTF-8 多字节字符。
      this.#frameBuffer.append(remainder);
    }
  };

  readonly #handleInputEnd = (): void => {
    if (this.#frameBuffer.hasNonWhitespace()) {
      this.#fail(
        new RpcProtocolError(
          `RPC input ended with an incomplete JSONL frame (${String(this.#frameBuffer.byteLength)} bytes)`,
        ),
      );
      return;
    }
    this.#inputEnded = true;
    if (this.#queuedFrameCount > 0) return;
    this.#finishInputEnd();
  };

  #finishInputEnd(): void {
    if (this.#closeOnInputEnd) {
      this.close(new RpcConnectionClosedError("RPC input stream ended"));
    }
  }

  readonly #handleStreamError = (error: Error): void => {
    this.#fail(new RpcConnectionClosedError(`RPC stream failed: ${error.message}`));
  };

  #failOversizedFrame(frameBytes: number): void {
    this.#fail(
      new RpcProtocolError(
        `RPC JSONL frame exceeds ${String(this.#maxFrameBytes)} bytes (${String(frameBytes)} bytes)`,
      ),
    );
  }

  #handleFrame(frame: Buffer): boolean {
    if (frame.length >= this.#largeFrameThresholdBytes || this.#queuedFrameCount > 0) {
      this.#enqueueFrame(frame, frame.length >= this.#largeFrameThresholdBytes);
      return true;
    }
    const line = frame.toString("utf8");
    if (!line.trim()) {
      return true;
    }
    try {
      this.#handleLine(line, frame.length);
      return true;
    } catch (error) {
      const protocolError =
        error instanceof RpcProtocolError
          ? error
          : new RpcProtocolError(
              `RPC JSONL frame processing failed (${String(frame.length)} bytes)`,
            );
      this.#fail(protocolError);
      return false;
    }
  }

  #enqueueFrame(frame: Buffer, useWorker: boolean): void {
    this.#queuedFrameCount += 1;
    if (this.#queuedFrameCount === 1) this.#input.pause();
    const task = this.#frameQueue.then(async () => {
      if (this.#closed) return;
      if (useWorker) {
        this.#frameProcessor ??= new JsonlFrameProcessor({
          ...(this.#workerUrl === undefined ? {} : { workerUrl: this.#workerUrl }),
        });
        const message = await this.#frameProcessor.parse(frame);
        this.#handleMessage(message);
        return;
      }
      this.#handleLine(frame.toString("utf8"), frame.length);
    });
    this.#frameQueue = task.catch(() => undefined);
    void task
      .catch((error: unknown) => {
        this.#failQueuedFrame(error, frame.length);
      })
      .finally(() => {
        this.#queuedFrameCount -= 1;
        if (this.#queuedFrameCount === 0 && !this.#closed) {
          if (this.#inputEnded) this.#finishInputEnd();
          else this.#input.resume();
        }
      });
  }

  #failQueuedFrame(error: unknown, frameBytes: number): void {
    const protocolError =
      error instanceof RpcProtocolError
        ? error
        : error instanceof JsonlFrameParseError && error.code === "json_parse_failed"
          ? new RpcProtocolError(
              `Invalid JSONL frame (${String(frameBytes)} bytes; JSON parse failed)`,
            )
          : new RpcProtocolError(`RPC JSONL frame processing failed (${String(frameBytes)} bytes)`);
    this.#fail(protocolError);
  }

  #handleLine(line: string, frameBytes: number): void {
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      // JSON.parse 的原始异常可能带输入片段，因此只记录安全的帧元数据。
      throw new RpcProtocolError(
        `Invalid JSONL frame (${String(frameBytes)} bytes; JSON parse failed)`,
      );
    }
    this.#handleMessage(message);
  }

  #handleMessage(message: unknown): void {
    if (!isRecord(message)) {
      throw new RpcProtocolError("RPC frame must be a JSON object");
    }

    const id = message["id"];
    if (typeof id === "number" && ("result" in message || "error" in message)) {
      this.#handleResponse(id, message);
      return;
    }
    const method = message["method"];
    if (
      isRequestId(id) &&
      typeof method === "string" &&
      !("result" in message) &&
      !("error" in message)
    ) {
      const request = { id, method, params: message["params"] };
      for (const listener of this.#serverRequestListeners) {
        listener(request);
      }
      return;
    }
    if (!("id" in message) && typeof method === "string") {
      const notification = { method, params: message["params"] };
      for (const listener of this.#notificationListeners) {
        listener(notification);
      }
      return;
    }

    throw new RpcProtocolError("RPC frame is neither a response, server request, nor notification");
  }

  #handleResponse(id: number, message: Record<string, unknown>): void {
    const pending = this.#pending.get(id);
    if (!pending) {
      return;
    }

    if ("error" in message) {
      const error = parseRpcError(message["error"]);
      if (!error) {
        throw new RpcProtocolError("RPC error response has an invalid error payload");
      }
      if (isExplicitlyUnqueuedOverload(error)) {
        // 只有服务端明确声明请求未入队时，才允许安全重发同一逻辑请求。
        const scheduled = pending.scheduleOverloadRetry(this.#overloadRetryPolicy, () => {
          if (this.#pending.get(id) !== pending) {
            return;
          }
          try {
            void this.#sendMessage(pending.request).catch(() => undefined);
          } catch {
            // #sendMessage 已关闭连接并拒绝当前 Pending RPC。
          }
        });
        if (scheduled) {
          return;
        }
      }
      this.#removePending(id, pending);
      pending.reject(new RpcResponseError(error));
      return;
    }
    if (!("result" in message)) {
      throw new RpcProtocolError("RPC response is missing result or error");
    }
    this.#removePending(id, pending);
    pending.resolve(message["result"]);
  }

  #removePending(id: number, pending: RpcPendingRequest): boolean {
    if (this.#pending.get(id) !== pending) {
      return false;
    }
    this.#pending.delete(id);
    pending.clearTimers();
    return true;
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new RpcConnectionClosedError();
    }
  }

  #fail(error: Error): void {
    if (this.#closed) {
      return;
    }
    for (const listener of this.#errorListeners) {
      listener(error);
    }
    this.close(error);
  }

  #toConnectionError(error: unknown): RpcConnectionClosedError {
    if (error instanceof RpcConnectionClosedError) {
      return error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    return new RpcConnectionClosedError(`RPC write failed: ${reason}`);
  }
}
