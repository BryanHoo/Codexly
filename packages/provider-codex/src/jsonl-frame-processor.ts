import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { Worker } from "node:worker_threads";

import { MAX_AGENT_HISTORY_IMAGE_TOTAL_BYTES, type AgentImageMediaType } from "@codexly/protocol";

const STAGED_IMAGE_MARKER = "__codexlyStagedImageV1";
const IMAGE_MEDIA_TYPES = new Set<AgentImageMediaType>([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const stagedImageAttachment = Symbol("stagedImageAttachment");

export type StagedImageAttachment = Readonly<{
  contentDigest: string;
  mediaType: AgentImageMediaType;
  path: string;
  size: number;
}>;

type WorkerResponse =
  | Readonly<{ id: number; message: unknown; type: "result" }>
  | Readonly<{ code: string; id: number; type: "error" }>;

type PendingRequest = Readonly<{
  reject: (reason?: unknown) => void;
  resolve: (message: unknown) => void;
}>;

export class JsonlFrameParseError extends Error {
  public readonly code: string;

  public constructor(code: string) {
    super(`JSONL frame worker failed: ${code}`);
    this.name = "JsonlFrameParseError";
    this.code = code;
  }
}

export interface JsonlFrameProcessorOptions {
  maxImageBytes?: number;
  workerUrl?: URL;
}

export class JsonlFrameProcessor {
  readonly #pending = new Map<number, PendingRequest>();
  readonly #stagingDirectory: string;
  readonly #worker: Worker;
  #closed = false;
  #nextRequestId = 1;

  public constructor(options: JsonlFrameProcessorOptions = {}) {
    this.#stagingDirectory = mkdtempSync(join(tmpdir(), "codexly-jsonl-images-"));
    this.#worker = new Worker(
      options.workerUrl ?? new URL("./codex-jsonl-frame-worker.js", import.meta.url),
      {
        workerData: {
          marker: STAGED_IMAGE_MARKER,
          maxImageBytes: options.maxImageBytes ?? MAX_AGENT_HISTORY_IMAGE_TOTAL_BYTES,
          stagingDirectory: this.#stagingDirectory,
        },
      },
    );
    this.#worker.unref();
    this.#worker.on("message", (response: WorkerResponse) => {
      const pending = this.#pending.get(response.id);
      if (pending === undefined) return;
      this.#pending.delete(response.id);
      if (response.type === "error") {
        pending.reject(new JsonlFrameParseError(response.code));
        return;
      }
      this.#hydrateStagedImages(response.message);
      pending.resolve(response.message);
    });
    this.#worker.once("error", (error: Error) => {
      this.#rejectPending(error);
    });
    this.#worker.once("exit", (code) => {
      if (!this.#closed || this.#pending.size > 0) {
        this.#closed = true;
        this.#rejectPending(new Error(`JSONL frame worker exited with code ${String(code)}`));
        rmSync(this.#stagingDirectory, { force: true, recursive: true });
      }
    });
  }

  public parse(frame: Buffer): Promise<unknown> {
    if (this.#closed) return Promise.reject(new Error("JSONL frame processor is closed"));
    const id = this.#nextRequestId++;
    // 输入通常是 stdout 大块的视图；复制后转移可避免克隆整块且不分离流缓冲区。
    const transferable = Uint8Array.from(frame);
    const transferredBuffer = transferable.buffer;
    return new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { reject, resolve });
      this.#worker.postMessage({ frame: transferredBuffer, id }, [transferredBuffer]);
    });
  }

  public dispose(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#rejectPending(new Error("JSONL frame processor is closed"));
    void this.#worker.terminate().finally(() => {
      rmSync(this.#stagingDirectory, { force: true, recursive: true });
    });
  }

  #hydrateStagedImages(message: unknown): void {
    const records = isRecord(message) ? [message] : [];
    while (records.length > 0) {
      const record = records.pop();
      if (record === undefined) continue;
      const staged = parseStagedImage(record[STAGED_IMAGE_MARKER], this.#stagingDirectory);
      Reflect.deleteProperty(record, STAGED_IMAGE_MARKER);
      if (staged !== undefined)
        Object.defineProperty(record, stagedImageAttachment, { value: staged });
      for (const value of Object.values(record)) {
        if (Array.isArray(value)) {
          for (const item of value) if (isRecord(item)) records.push(item);
        } else if (isRecord(value)) {
          records.push(value);
        }
      }
    }
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }
}

export function readStagedImage(value: Record<string, unknown>): StagedImageAttachment | undefined {
  return Reflect.get(value, stagedImageAttachment) as StagedImageAttachment | undefined;
}

export function stagedImageName(
  value: Record<string, unknown>,
  imageIndex: number,
): string | undefined {
  return value["type"] === "image" ? `图片-${String(imageIndex + 1)}` : undefined;
}

function parseStagedImage(value: unknown, directory: string): StagedImageAttachment | undefined {
  if (
    !isRecord(value) ||
    typeof value["contentDigest"] !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value["contentDigest"]) ||
    typeof value["mediaType"] !== "string" ||
    !IMAGE_MEDIA_TYPES.has(value["mediaType"] as AgentImageMediaType) ||
    typeof value["path"] !== "string" ||
    !isStagingPath(directory, value["path"]) ||
    typeof value["size"] !== "number" ||
    !Number.isSafeInteger(value["size"]) ||
    value["size"] <= 0
  )
    return undefined;
  return {
    contentDigest: value["contentDigest"],
    mediaType: value["mediaType"] as AgentImageMediaType,
    path: value["path"],
    size: value["size"],
  };
}

function isRecord(value: unknown): value is Record<string | symbol, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStagingPath(directory: string, path: string): boolean {
  const child = relative(directory, path);
  return isAbsolute(path) && child.length > 0 && !child.startsWith("..") && !isAbsolute(child);
}
