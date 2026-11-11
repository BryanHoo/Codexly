import { Buffer } from "node:buffer";
import { open } from "node:fs/promises";
import type { Readable } from "node:stream";

export async function readAttachmentHeader(path: string, bytes: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const value = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(value, 0, bytes, 0);
    return value.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** 调用方先完成项目授权，再持有文件句柄；逐块消费或 destroy 都会关闭句柄。 */
export async function openAttachmentStream(path: string): Promise<Readable> {
  const handle = await open(path, "r");
  return handle.createReadStream({ highWaterMark: 256 * 1024, autoClose: true });
}
