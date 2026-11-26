import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { acpBuildTarget } from "./acp-build-target.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
/** 仅构建共享宿主，不改写现有生产资源；智能体由官方目录按需安装。 */
const target = acpBuildTarget(
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
if (target.platform === process.platform && target.arch === process.arch) {
  const version = spawnSync(outfile, ["--version"], { encoding: "utf8", timeout: 30_000 });
  if (version.status !== 0 || version.stdout.trim() !== "codexly-acp-host/1")
    throw version.error ?? new Error("Compiled ACP host verification failed");
}
