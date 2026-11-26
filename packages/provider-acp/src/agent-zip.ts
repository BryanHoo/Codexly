import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { openPromise } from "yauzl";

/** ZIP 不经过系统 tar：Ubuntu 的 GNU tar 不支持 ZIP，桌面宿主也不能依赖额外的 unzip。 */
export async function extractAgentZip(archive: string, directory: string, signal?: AbortSignal) {
  const zip = await openPromise(archive, { lazyEntries: true, strictFileNames: true });
  let expanded = 0;
  try {
    if (zip.entryCount > 100_000) throw new Error("Agent 压缩包文件数量超过限制");
    // 串行读取中央目录并用流背压写入，避免大 ZIP 同时解压全部文件或占满内存。
    for await (const entry of zip.eachEntry()) {
      signal?.throwIfAborted();
      const name = entry.fileName;
      const target = resolve(directory, name);
      const path = relative(directory, target);
      if (
        isAbsolute(name) ||
        name.includes("\\") ||
        name.includes(":") ||
        name.includes("\0") ||
        name.split("/").includes("..") ||
        isAbsolute(path) ||
        path.startsWith("..")
      )
        throw new Error("Agent 压缩包包含无效路径");
      const type = (entry.externalFileAttributes >>> 16) & 0o170000;
      const isDirectory = name.endsWith("/");
      // 只接受普通文件和目录，禁止符号链接、设备及类型伪装后再写入磁盘。
      if (type !== 0 && type !== (isDirectory ? 0o040000 : 0o100000))
        throw new Error("Agent 压缩包包含链接或特殊文件");
      expanded += entry.uncompressedSize;
      if (expanded > 1024 * 1024 * 1024) throw new Error("Agent 压缩包解压大小超过限制");
      if (isDirectory) {
        await mkdir(target, { recursive: true, mode: 0o700 });
        continue;
      }
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      const stream = await zip.openReadStreamPromise(entry);
      // 独占创建避免覆盖下载源和重复条目；保留辅助程序的执行位，仅向当前用户开放。
      const executable = (entry.externalFileAttributes >>> 16) & 0o111;
      await pipeline(
        stream,
        createWriteStream(target, { flags: "wx", mode: executable ? 0o700 : 0o600 }),
        { signal },
      );
    }
  } finally {
    zip.close();
  }
}
