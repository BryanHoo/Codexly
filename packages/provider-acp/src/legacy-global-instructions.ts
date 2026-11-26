import { open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { applicationPreferencesFromLegacy, type LocalCatalogStore } from "@codexly/core";
import { legacyGlobalInstructions } from "@codexly/protocol/application-preferences";

async function readLegacyInstructions(path: string): Promise<string | undefined> {
  try {
    const info = await stat(path);
    if (info.size > legacyGlobalInstructions.maxFileBytes)
      throw new Error("Legacy instructions exceed capacity");
    if (!info.isFile()) throw new Error("Legacy instructions must be a regular file");
    const file = await open(path, "r");
    try {
      // 多读一个字节识别读取期间增长的文件，避免写入残缺正文。
      const buffer = Buffer.allocUnsafe(legacyGlobalInstructions.maxFileBytes + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await file.read(buffer, length, buffer.length - length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length === buffer.length) throw new Error("Legacy instructions exceed capacity");
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        buffer.subarray(0, length),
      );
    } finally {
      await file.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

/** 启动时只导入用户目录的旧指令，SQLite 事务负责与用户更新串行化。 */
export async function importAcpLegacyGlobalInstructions(
  store: LocalCatalogStore,
  environment: NodeJS.ProcessEnv,
  readPreferences: () => Promise<unknown>,
): Promise<void> {
  const saved = await store.catalog("app.preferences.read", {});
  if (saved?.globalInstructions !== undefined) return;
  const home = homedir();
  // 共享配置按 Codex 生效顺序排列；找到首份非空指令后，后续来源无需读取。
  for (const source of legacyGlobalInstructions.sources) {
    const configuredDirectory = environment[source.env];
    const directory =
      (configuredDirectory === "" ? undefined : configuredDirectory) ??
      join(home, source.directory);
    const content = await readLegacyInstructions(join(directory, source.file));
    if (!content?.trim()) continue;
    const baseline = saved ?? applicationPreferencesFromLegacy(await readPreferences());
    await store.catalog("app.preferences.importInstructions", { baseline, content });
    return;
  }
}
