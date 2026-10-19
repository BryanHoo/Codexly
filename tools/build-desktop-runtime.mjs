import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { chmod, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeBuildTarget } from "./claude-build-target.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const resources = join(root, "desktop/src-tauri/resources");
const target = claudeBuildTarget(
  process.env.CODEXLY_CLAUDE_TARGET ?? process.env.TAURI_ENV_TARGET_TRIPLE,
);
const codexEntry = import.meta.resolve("@openai/codex/package.json");
const { version } = JSON.parse(await readFile(new URL(codexEntry), "utf8"));
const packageVersion = `${version}-${target.platform}-${target.arch}`;
const triple = `${target.arch === "arm64" ? "aarch64" : "x86_64"}-${target.platform === "darwin" ? "apple-darwin" : target.platform === "win32" ? "pc-windows-msvc" : "unknown-linux-musl"}`;
let packageRoot;
try {
  packageRoot = dirname(
    createRequire(codexEntry).resolve(
      `@openai/codex-${target.platform}-${target.arch}/package.json`,
    ),
  );
} catch {
  // 交叉构建只下载目标架构，锁文件摘要校验通过后才允许解包。
  const cache = join(resources, "codex-native-cache", packageVersion);
  await mkdir(cache, { recursive: true });
  const archive = join(cache, "package.tgz");
  const lock = await readFile(join(root, "pnpm-lock.yaml"), "utf8");
  const start = lock.indexOf(`'@openai/codex@${packageVersion}':`);
  const integrity =
    start < 0
      ? undefined
      : /integrity: sha512-([A-Za-z0-9+/=]+)/u.exec(lock.slice(start, start + 500))?.[1];
  if (!integrity) throw new Error("Codex target is missing from the verified lockfile");
  const valid = (bytes) => createHash("sha512").update(bytes).digest("base64") === integrity;
  let bytes;
  try {
    bytes = await readFile(archive);
  } catch {
    /* 首次构建尚无缓存。 */
  }
  if (!bytes || !valid(bytes)) {
    const response = await fetch(
      `https://registry.npmjs.org/@openai/codex/-/codex-${packageVersion}.tgz`,
      { signal: AbortSignal.timeout(120_000) },
    );
    if (!response.ok) throw new Error(`Codex build download failed: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (!valid(bytes)) throw new Error("Codex package integrity mismatch");
    await writeFile(archive, bytes);
  }
  await rm(join(cache, "package"), { recursive: true, force: true });
  const extraction = spawnSync("tar", ["-xzf", archive, "-C", cache, "package"], {
    stdio: "inherit",
  });
  if (extraction.status !== 0) throw extraction.error ?? new Error("Codex extraction failed");
  packageRoot = join(cache, "package");
}
const installed = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
if (installed.version !== packageVersion) throw new Error("Codex target version mismatch");
const sidecarTriple = triple.replace("unknown-linux-musl", "unknown-linux-gnu");
const binaries = join(root, "desktop/src-tauri/binaries");
await mkdir(binaries, { recursive: true });
const stage = join(resources, `.runtime-${process.pid}`);
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
try {
  // 保留官方 vendor 相对布局，Windows 沙箱辅助程序与 ripgrep 必须随主程序一并打包。
  await cp(join(packageRoot, "vendor", triple), join(stage, "codex"), { recursive: true });
  // npm 原生包未附带完整许可，随安装包保留固定版本官方源码中的 LICENSE 与 NOTICE。
  for (const name of ["LICENSE", "NOTICE"]) {
    await cp(join(root, "tools/runtime-licenses", `codex-${name}`), join(stage, "codex", name));
  }
  for (const name of ["README.md", "LICENSE", "NOTICE"]) {
    try {
      await cp(join(packageRoot, name), join(stage, "codex", name));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  // 旧版 macOS 不支持 Claude 原生运行时，不携带不可执行的大体积文件。
  if (process.env.CODEAGENT_MACOS_PROFILE !== "legacy") {
    const build = spawnSync(process.execPath, [join(root, "tools/build-claude-host.mjs")], {
      stdio: "inherit",
      env: process.env,
    });
    if (build.status !== 0) throw build.error ?? new Error("Claude host build failed");
    await mkdir(join(stage, "claude"));
    await cp(
      join(root, "tools/runtime-licenses/bun-LICENSE"),
      join(stage, "claude/BUN-LICENSE.md"),
    );
    const suffix = target.platform === "win32" ? ".exe" : "";
    for (const name of [
      `claude${suffix}`,
      "README.md",
      "LICENSE.md",
      "SDK-README.md",
      "manifest.json",
    ]) {
      await cp(join(resources, "claude", name), join(stage, "claude", name));
    }
    // 官方程序保留原厂签名与布局；自建宿主作为 Tauri sidecar 自动签名并参与公证。
    await cp(
      join(resources, "claude", `claude-host${suffix}`),
      join(binaries, `claude-host-${sidecarTriple}${suffix}`),
    );
    if (target.platform !== "win32") {
      await chmod(join(stage, "claude/claude"), 0o755);
      await chmod(join(binaries, `claude-host-${sidecarTriple}`), 0o755);
    }
  }
  await writeFile(
    join(stage, "manifest.json"),
    JSON.stringify({ schemaVersion: 1, ...target, codexVersion: version }) + "\n",
  );
  // staging 不包含缓存、压缩归档或其他架构；每次构建清空旧目标，避免增量打包混入旧文件。
  await rm(join(resources, "runtime"), { recursive: true, force: true });
  await rename(stage, join(resources, "runtime"));
  console.log(`Bundled runtime: ${target.platform}/${target.arch}, Codex ${version}`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
