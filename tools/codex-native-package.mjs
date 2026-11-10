import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

/** 从 adapter 自己的 Codex 依赖选择平台包；交叉目标只下载锁文件固定且摘要匹配的归档。 */
export async function resolveCodexNativePackage(root, adapterManifest, target) {
  const wrapper = createRequire(adapterManifest).resolve("@openai/codex/package.json");
  const { version } = JSON.parse(await readFile(wrapper, "utf8"));
  const name = `@openai/codex-${target.platform}-${target.arch}`,
    expected = `${version}-${target.platform}-${target.arch}`;
  try {
    const manifest = createRequire(wrapper).resolve(`${name}/package.json`);
    if (JSON.parse(await readFile(manifest, "utf8")).version !== expected)
      throw new Error("Codex native version mismatch");
    return { directory: dirname(manifest), version };
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
  }
  const lock = await readFile(join(root, "pnpm-lock.yaml"), "utf8");
  const start = lock.indexOf(`'@openai/codex@${expected}':`);
  const integrity =
    start < 0
      ? undefined
      : /integrity: sha512-([A-Za-z0-9+/=]+)/u.exec(lock.slice(start, start + 500))?.[1];
  if (!integrity) throw new Error("Codex target is missing from the verified lockfile");
  const cache = join(root, ".artifacts/acp-native-cache", expected),
    archive = join(cache, "package.tgz");
  await mkdir(cache, { recursive: true });
  const valid = (bytes) => createHash("sha512").update(bytes).digest("base64") === integrity;
  let bytes;
  try {
    bytes = await readFile(archive);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!bytes || !valid(bytes)) {
    const response = await fetch(
      `https://registry.npmjs.org/@openai/codex/-/codex-${expected}.tgz`,
      { signal: AbortSignal.timeout(120_000) },
    );
    if (!response.ok) throw new Error("Codex target download failed");
    bytes = Buffer.from(await response.arrayBuffer());
    if (!valid(bytes)) throw new Error("Codex target integrity mismatch");
    await writeFile(archive, bytes);
  }
  await rm(join(cache, "package"), { recursive: true, force: true });
  const unpack = spawnSync("tar", ["-xzf", archive, "-C", cache, "package"], { stdio: "inherit" });
  if (unpack.status !== 0) throw unpack.error ?? new Error("Codex target extraction failed");
  const directory = join(cache, "package");
  if (JSON.parse(await readFile(join(directory, "package.json"), "utf8")).version !== expected)
    throw new Error("Codex native version mismatch");
  return { directory, version };
}
