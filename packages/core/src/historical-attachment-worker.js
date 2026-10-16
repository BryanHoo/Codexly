import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parentPort } from "node:worker_threads";

import { detectImageMediaType } from "./historical-image-media-type.js";

function invalidAttachment(message) {
  return Object.assign(new Error(message), { code: "INVALID_ATTACHMENT" });
}

async function processAttachment(job) {
  let source;
  let content;
  let expectedSize = job.size;
  if (job.source.type === "file") {
    const info = await stat(job.source.path);
    if (
      !info.isFile() ||
      info.size <= 0 ||
      info.size > job.maxBytes ||
      (expectedSize !== undefined && info.size !== expectedSize)
    )
      throw invalidAttachment("Invalid attachment size");
    expectedSize = info.size;
  } else {
    content = Buffer.from(job.source.value, job.source.type === "base64" ? "base64" : "utf8");
    if (content.length === 0 || content.length > job.maxBytes)
      throw invalidAttachment("Invalid attachment size");
    if (
      job.source.type === "base64" &&
      content.toString("base64").replace(/=+$/u, "") !== job.source.value.replace(/=+$/u, "")
    )
      throw invalidAttachment("Invalid Base64");
    expectedSize = content.length;
    // 字符串转换只在 Worker 内执行；写盘仍按小块背压推进，避免长任务占满 libuv 线程池。
    source = Readable.from(
      (function* () {
        for (let offset = 0; offset < content.length; offset += 64 * 1024)
          yield content.subarray(offset, offset + 64 * 1024);
      })(),
    );
  }
  const hash = createHash("sha256");
  const header = Buffer.alloc(12);
  let size = 0;
  const download = job.operation === "read" ? new ArrayBuffer(expectedSize) : undefined;
  const downloadBytes = download === undefined ? undefined : Buffer.from(download);
  let temporaryPath;
  try {
    if (job.operation === "persist") {
      await mkdir(job.directory, { recursive: true });
      temporaryPath = join(job.directory, `${randomUUID()}.tmp`);
    }
    // 文件流在 pipeline 安装错误监听前才创建，避免等待 mkdir 时源文件变化产生未捕获错误。
    if (job.source.type === "file")
      source = createReadStream(job.source.path, { highWaterMark: 64 * 1024 });
    const validator = new Transform({
      transform(chunk, _encoding, callback) {
        // 对每个分块重新检查上限，防止源文件在 stat 后增长而绕过预算。
        if (size + chunk.length > job.maxBytes || size + chunk.length > expectedSize) {
          callback(invalidAttachment("Attachment grew during read"));
          return;
        }
        if (size < header.length)
          chunk.copy(header, size, 0, Math.min(chunk.length, header.length - size));
        hash.update(chunk);
        downloadBytes?.set(chunk, size);
        size += chunk.length;
        callback(null, job.operation === "read" ? undefined : chunk);
      },
    });
    if (temporaryPath === undefined) await pipeline(source, validator);
    else await pipeline(source, validator, createWriteStream(temporaryPath, { flags: "wx" }));
    const blobKey = hash.digest("hex");
    const mediaType =
      job.kind === "image"
        ? detectImageMediaType(header.subarray(0, Math.min(size, header.length)))
        : job.mediaType;
    if (
      size !== expectedSize ||
      mediaType === undefined ||
      (job.mediaType !== undefined && mediaType !== job.mediaType) ||
      (job.digest !== undefined && blobKey !== job.digest)
    )
      throw invalidAttachment("Attachment validation failed");
    let path;
    if (temporaryPath !== undefined) {
      path = join(job.directory, blobKey);
      // 同一摘要代表同一正文；独立随机暂存名允许并发写入，完整校验后才原子发布。
      await rename(temporaryPath, path);
    }
    return { blobKey, content: download, mediaType, path, size };
  } finally {
    source?.destroy();
    if (temporaryPath !== undefined) await rm(temporaryPath, { force: true });
  }
}

parentPort.on("message", async (job) => {
  try {
    const result = await processAttachment(job);
    parentPort.postMessage({ result }, result.content === undefined ? [] : [result.content]);
  } catch (error) {
    parentPort.postMessage({
      error: error instanceof Error ? error.message : String(error),
      invalid: error?.code === "INVALID_ATTACHMENT" || error?.code === "ENOENT",
    });
  }
});
