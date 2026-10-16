import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

/** 交叉构建只下载目标原生包，校验锁文件摘要，避免安装全部平台的大体积依赖。 */
export async function resolveClaudeNativePackage(root, sdkEntry, target) {
  const name = `@anthropic-ai/claude-agent-sdk-${target.platform}-${target.arch}`;
  try {
    return createRequire(sdkEntry).resolve(`${name}/package.json`);
  } catch {
    /* 当前宿主安装通常不包含交叉目标的可选依赖。 */
  }
  const cache = join(
    root,
    "desktop/src-tauri/resources/claude-native-cache",
    `${target.platform}-${target.arch}-0.3.300`,
  );
  const lock = await readFile(join(root, "pnpm-lock.yaml"), "utf8");
  const marker = `'${name}@0.3.300':`;
  const start = lock.indexOf(marker);
  const integrity =
    start < 0
      ? undefined
      : /integrity: (sha512-[A-Za-z0-9+/=]+)/u.exec(lock.slice(start, start + 500))?.[1];
  if (!integrity) throw new Error("Claude target package is missing from the verified lockfile");
  await mkdir(cache, { recursive: true });
  const archive = join(cache, "package.tgz");
  const valid = (bytes) =>
    `sha512-${createHash("sha512").update(bytes).digest("base64")}` === integrity;
  let bytes;
  try {
    bytes = await readFile(archive);
  } catch {
    /* 首次目标构建需要下载。 */
  }
  if (!bytes || !valid(bytes)) {
    const packageName = name.split("/").at(-1);
    const response = await fetch(
      `https://registry.npmjs.org/${name}/-/${packageName}-0.3.300.tgz`,
      { signal: AbortSignal.timeout(120_000) },
    );
    if (!response.ok) throw new Error(`Claude target download failed: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (!valid(bytes)) throw new Error("Claude target package integrity mismatch");
    await writeFile(archive, bytes);
  }
  await rm(join(cache, "package"), { recursive: true, force: true });
  const result = spawnSync("tar", ["-xzf", archive, "-C", cache, "package"], { stdio: "inherit" });
  if (result.status !== 0)
    throw result.error ?? new Error("Claude target package extraction failed");
  return join(cache, "package/package.json");
}
