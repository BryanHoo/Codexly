import { open } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import type { FastifyReply } from "fastify";

import { createAttachmentContentDisposition } from "./project-file-download.js";

function parseRange(range: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/u.exec(range);
  if (match === null || (match[1] === "" && match[2] === "")) return null;
  const start = match[1] === "" ? Math.max(0, size - Number(match[2])) : Number(match[1]);
  const end = match[1] === "" || match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end && start < size
    ? { start, end }
    : null;
}

export async function sendProjectPdf(
  reply: FastifyReply,
  root: string,
  path: string,
  range?: string,
): Promise<void> {
  const filePath = isAbsolute(path) ? path : resolve(root, path);
  const file = await open(filePath, "r");
  let streamed = false;
  try {
    const metadata = await file.stat();
    const signature = Buffer.alloc(5);
    await file.read(signature, 0, signature.length, 0);
    // 同一文件句柄完成签名校验和交付，拒绝把伪装成 PDF 的 HTML 内嵌到应用。
    if (!metadata.isFile() || signature.toString("ascii") !== "%PDF-") {
      throw new TypeError("Invalid PDF file");
    }
    reply
      .type("application/pdf")
      .header(
        "content-disposition",
        createAttachmentContentDisposition(basename(filePath)).replace(/^attachment/u, "inline"),
      )
      .header("cache-control", "private, no-cache")
      .header("accept-ranges", "bytes");
    const interval = range === undefined ? undefined : parseRange(range, metadata.size);
    if (interval === null) {
      await reply
        .code(416)
        .header("content-range", `bytes */${String(metadata.size)}`)
        .send();
      return;
    }
    if (interval !== undefined) {
      reply
        .code(206)
        .header(
          "content-range",
          `bytes ${String(interval.start)}-${String(interval.end)}/${String(metadata.size)}`,
        );
    }
    reply.header(
      "content-length",
      interval === undefined ? metadata.size : interval.end - interval.start + 1,
    );
    // 按浏览器请求范围读取，避免完整 PDF 缓冲或经由 JSON/Base64 传输。
    const stream = file.createReadStream(interval);
    streamed = true;
    await reply.send(stream);
  } finally {
    if (!streamed) await file.close();
  }
}
