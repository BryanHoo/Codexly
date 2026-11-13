import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeBuildTarget } from "./claude-build-target.mjs";
import { runtimeInventory, verifyAcpRuntime } from "./acp-runtime-layout.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = claudeBuildTarget(
  process.env.CODEXLY_ACP_TARGET ?? process.env.TAURI_ENV_TARGET_TRIPLE,
);
const resources = join(root, "desktop/src-tauri/resources");
const binaries = join(root, "desktop/src-tauri/binaries");
const stage = join(resources, `.acp-runtime-${randomUUID()}`);
const suffix = target.platform === "win32" ? ".exe" : "";
const triple = `${target.arch === "arm64" ? "aarch64" : "x86_64"}-${target.platform === "darwin" ? "apple-darwin" : target.platform === "win32" ? "pc-windows-msvc" : "unknown-linux-gnu"}`;
const sidecar = join(binaries, `acp-host-${triple}${suffix}`);
const temporarySidecar = `${sidecar}.${randomUUID()}.tmp`;
await mkdir(resources, { recursive: true });
await mkdir(binaries, { recursive: true });
try {
  // 先构建、核对完整目标资源，再发布；依赖下载和编译失败不会替换已有可运行资源。
  const built = spawnSync(process.execPath, [join(root, "tools/build-acp-runtime.mjs"), stage], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (built.status !== 0) throw built.error ?? new Error("ACP runtime build failed");
  const manifest = await verifyAcpRuntime(stage, target);
  await rename(join(stage, manifest.host.path), temporarySidecar);
  // 自建 Bun 宿主必须作为 Tauri sidecar 签名；原厂程序保留原布局和签名，不复制第二份宿主。
  manifest.host.placement = "sidecar";
  manifest.files = (await runtimeInventory(stage)).filter(
    (entry) => entry.path !== "manifest.json",
  );
  await writeFile(join(stage, "manifest.json"), JSON.stringify(manifest) + "\n");
  await verifyAcpRuntime(stage, target, temporarySidecar);
  if (target.platform !== "win32") await chmod(temporarySidecar, 0o755);
  await rename(temporarySidecar, sidecar);
  await rm(join(resources, "runtime"), { recursive: true, force: true });
  await rename(stage, join(resources, "runtime"));
  // 从落盘清单取版本，避免关于页或日志误读旧 SDK 的包元数据。
  const published = JSON.parse(await readFile(join(resources, "runtime/manifest.json"), "utf8"));
  console.log(
    `Bundled ACP runtime: ${target.platform}/${target.arch}, Codex ${published.engines.codex.version}, Claude ${published.engines.claude.version}`,
  );
} finally {
  await rm(stage, { recursive: true, force: true });
  await rm(temporarySidecar, { force: true });
}
