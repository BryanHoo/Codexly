import { readdir, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rustDirectory = fileURLToPath(new URL("../src-tauri", import.meta.url));
const cacheDirectories = new Set([".fingerprint", "build", "deps", "incremental", "examples"]);

export function resolveTauriTargetDirectory(environment = process.env) {
  // Tauri 在 src-tauri 中调用 Cargo；相对 CARGO_TARGET_DIR 也必须以此为基准。
  return resolve(rustDirectory, environment.CARGO_TARGET_DIR || "target");
}

export async function cleanTauriTarget(targetDirectory = resolveTauriTargetDirectory()) {
  let removed = 0;
  async function visit(directory, depth) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    const isProfile =
      ["debug", "release"].includes(basename(directory)) ||
      entries.some((entry) => entry.name === ".fingerprint" && entry.isDirectory());
    if (isProfile) {
      // 只删除可重新编译的缓存，保留同级可执行程序、动态库、调试符号及完整 bundle。
      // 逐目录删除，避免大量并行文件操作挤占本地磁盘和线程池。
      for (const entry of entries) {
        if (!cacheDirectories.has(entry.name)) continue;
        await rm(join(directory, entry.name), { recursive: true, force: true });
        removed += 1;
      }
      return;
    }
    // 覆盖 target/profile、target/triple/profile 和 target/legacy/triple/profile。
    // 不跟随符号链接，也不进入安装包或依赖树，避免误删产物并限制扫描开销。
    if (depth >= 3) return;
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== "bundle" && !cacheDirectories.has(entry.name)) {
        await visit(join(directory, entry.name), depth + 1);
      }
    }
  }
  await visit(targetDirectory, 0);
  console.log(`已清理 ${removed} 个 Tauri 编译缓存目录，保留程序与安装包：${targetDirectory}`);
}

if (import.meta.main) {
  await cleanTauriTarget();
}
