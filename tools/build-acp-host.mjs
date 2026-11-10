import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeBuildTarget } from "./claude-build-target.mjs";
import { resolveRuntimePackage } from "./acp-runtime-layout.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(join(root, "packages/provider-acp/package.json"));
/** 仅构建共享宿主，不改写现有生产资源；原生引擎由后续资源阶段单独校验和供应。 */
const target = claudeBuildTarget(
  process.env.CODEXLY_ACP_TARGET ?? process.env.TAURI_ENV_TARGET_TRIPLE,
);
const suffix = target.platform === "win32" ? ".exe" : "";
const outfile = resolve(process.argv[2] ?? join(root, `.artifacts/acp/acp-host${suffix}`));
await mkdir(dirname(outfile), { recursive: true });
const bun = join(root, "node_modules/bun/bin/bun.exe");
const platform = target.platform === "win32" ? "windows" : target.platform;
const bunTarget = `bun-${platform}-${target.arch}${target.arch === "x64" ? "-baseline" : ""}`;
const built = spawnSync(
  bun,
  [
    "build",
    "packages/provider-acp/src/main.ts",
    "packages/core/src/historical-attachment-worker.js",
    "--root",
    ".",
    "--define",
    'CODEXLY_COMPILED_ATTACHMENT_WORKER="./packages/core/src/historical-attachment-worker.js"',
    "--compile",
    "--minify",
    `--target=${bunTarget}`,
    "--outfile",
    outfile,
  ],
  { cwd: root, stdio: "inherit" },
);
if (built.status !== 0) throw built.error ?? new Error("ACP host compilation failed");
const packages = {};
for (const name of [
  "@agentclientprotocol/sdk",
  "@agentclientprotocol/codex-acp",
  "@agentclientprotocol/claude-agent-acp",
]) {
  const directory = await resolveRuntimePackage(require, name);
  packages[name] = JSON.parse(await readFile(join(directory, "package.json"), "utf8")).version;
}
if (target.platform === process.platform && target.arch === process.arch) {
  const version = spawnSync(outfile, ["--version"], { encoding: "utf8", timeout: 30_000 });
  if (version.status !== 0 || version.stdout.trim() !== "codexly-acp-host/1")
    throw version.error ?? new Error("Compiled ACP host verification failed");
}
// 成品清单记录目标、固定包版本和摘要，不把本机路径或环境凭据写入清单。
await writeFile(
  `${outfile}.json`,
  JSON.stringify({
    schemaVersion: 1,
    platform: target.platform,
    arch: target.arch,
    packages,
    sha256: createHash("sha256")
      .update(await readFile(outfile))
      .digest("hex"),
  }) + "\n",
);
