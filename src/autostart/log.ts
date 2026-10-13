import { appendFile, chmod, open, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { ensurePrivateDirectory, isMissing } from "./config.js";

export function redact(text: string, secret?: string): string {
  return secret ? text.split(secret).join("[REDACTED]") : text;
}
export async function createLog(
  path: string,
  secret?: string,
  limit = 1024 * 1024,
): Promise<{ write: (text: string) => void; flush: () => Promise<void> }> {
  await ensurePrivateDirectory(dirname(path));
  await appendFile(path, "", { mode: 0o600 });
  if (process.platform !== "win32") await chmod(path, 0o600);
  let size = (await stat(path)).size;
  let queue = Promise.resolve();
  let pendingBytes = 0;
  let failure: Error | undefined;
  return {
    write(text) {
      // 后台日志只用于诊断，单条与排队数据均有上限，不允许大量错误耗尽内存或磁盘。
      const bytes = Buffer.from(`${new Date().toISOString()} ${redact(text, secret).trimEnd()}\n`);
      const entry = bytes.subarray(Math.max(0, bytes.length - Math.min(limit, 8192)));
      if (pendingBytes + entry.length > 65536) return;
      pendingBytes += entry.length;
      queue = queue
        .then(async () => {
          if (size + entry.length > limit) {
            await rename(path, `${path}.1`);
            size = 0;
          }
          await appendFile(path, entry, { mode: 0o600 });
          size += entry.length;
        })
        .catch((error: unknown) => {
          failure = error instanceof Error ? error : new Error(String(error));
        })
        .finally(() => {
          pendingBytes -= entry.length;
        });
    },
    async flush() {
      await queue;
      if (failure) throw failure;
    },
  };
}
export async function readLogTail(path: string): Promise<string> {
  let file;
  try {
    file = await open(path, "r");
    const size = (await file.stat()).size;
    const buffer = Buffer.alloc(Math.min(size, 65536));
    await file.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length));
    return buffer.toString("utf8");
  } catch (error) {
    if (isMissing(error)) return "暂无后台日志。\n";
    throw error;
  } finally {
    await file?.close();
  }
}
