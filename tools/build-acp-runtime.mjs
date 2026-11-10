import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, writeFile, rm, rename, lstat, copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { claudeBuildTarget } from "./claude-build-target.mjs";
import { resolveClaudeNativePackage } from "./claude-native-package.mjs";
import { readClaudeCodeVersion } from "./build-claude-host.mjs";
import { resolveCodexNativePackage } from "./codex-native-package.mjs";
import {
  readCodexLayout,
  runtimeInventory,
  sha256,
  verifyAcpRuntime,
  resolveRuntimePackage,
} from "./acp-runtime-layout.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(join(root, "packages/provider-acp/package.json"));
const target = claudeBuildTarget(
  process.env.CODEXLY_ACP_TARGET ?? process.env.TAURI_ENV_TARGET_TRIPLE,
);
const destination = resolve(
  process.argv[2] ?? join(root, `.artifacts/acp-runtime/${target.platform}-${target.arch}`),
);
// 当前阶段不覆盖生产资源或既有成品，使用全新目录原子发布完整资源包。
try {
  await lstat(destination);
  throw new Error("ACP runtime destination already exists");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const stage = `${destination}.stage-${randomUUID()}`;
await mkdir(stage, { recursive: true });
try {
  const codexAdapter = require.resolve("@agentclientprotocol/codex-acp/package.json");
  const claudeAdapter = require.resolve("@agentclientprotocol/claude-agent-acp/package.json");
  const codex = await resolveCodexNativePackage(root, codexAdapter, target);
  const triple = `${target.arch === "arm64" ? "aarch64" : "x86_64"}-${target.platform === "darwin" ? "apple-darwin" : target.platform === "win32" ? "pc-windows-msvc" : "unknown-linux-musl"}`;
  const codexRoot = join(codex.directory, "vendor", triple);
  const layout = await readCodexLayout(codexRoot, codex.version, triple);
  await cp(codexRoot, join(stage, "codex"), { recursive: true, verbatimSymlinks: true });
  const sdkEntry = pathToFileURL(
    createRequire(claudeAdapter).resolve("@anthropic-ai/claude-agent-sdk"),
  );
  const sdk = JSON.parse(await readFile(new URL("./package.json", sdkEntry), "utf8"));
  const claudeNative = await resolveClaudeNativePackage(root, sdkEntry, target);
  const nativeMetadata = JSON.parse(await readFile(claudeNative, "utf8"));
  if (
    nativeMetadata.version !== sdk.version ||
    !nativeMetadata.os?.includes(target.platform) ||
    !nativeMetadata.cpu?.includes(target.arch)
  )
    throw new Error("Claude native package version/target mismatch");
  const suffix = target.platform === "win32" ? ".exe" : "";
  await mkdir(join(stage, "claude"));
  await copyFile(
    join(dirname(claudeNative), `claude${suffix}`),
    join(stage, `claude/claude${suffix}`),
  );
  const host = `acp-host${suffix}`;
  const build = spawnSync(
    process.execPath,
    [join(root, "tools/build-acp-host.mjs"), join(stage, host)],
    { cwd: root, stdio: "inherit", env: process.env },
  );
  if (build.status !== 0) throw build.error ?? new Error("ACP host build failed");
  const licenses = join(stage, "licenses");
  const acpSdkRoot = await resolveRuntimePackage(require, "@agentclientprotocol/sdk");
  await mkdir(licenses);
  for (const name of ["LICENSE", "NOTICE"])
    await copyFile(
      join(root, "tools/runtime-licenses", `codex-${name}`),
      join(licenses, `codex-${name}`),
    );
  for (const [name, source] of [
    ["ACP-SDK-LICENSE", join(acpSdkRoot, "LICENSE")],
    ["codex-acp-LICENSE", join(dirname(codexAdapter), "LICENSE")],
    ["codex-acp-README.md", join(dirname(codexAdapter), "README.md")],
    ["claude-acp-LICENSE", join(dirname(claudeAdapter), "LICENSE")],
    ["claude-acp-README.md", join(dirname(claudeAdapter), "README.md")],
    ["claude-LICENSE.md", join(dirname(claudeNative), "LICENSE.md")],
    ["claude-README.md", join(dirname(claudeNative), "README.md")],
    ["claude-SDK-README.md", fileURLToPath(new URL("./README.md", sdkEntry))],
    ["BUN-LICENSE.md", join(root, "tools/runtime-licenses/bun-LICENSE")],
  ])
    await copyFile(source, join(licenses, name));
  const manifest = {
    schemaVersion: 1,
    platform: target.platform,
    arch: target.arch,
    host: { path: host, sha256: await sha256(join(stage, host)), protocolVersion: 1 },
    engines: {
      codex: { version: codex.version, entrypoint: `codex/${layout.entrypoint}` },
      claude: {
        version: await readClaudeCodeVersion(sdkEntry),
        sdkVersion: sdk.version,
        entrypoint: `claude/claude${suffix}`,
      },
    },
    files: await runtimeInventory(stage),
  };
  await writeFile(join(stage, "manifest.json"), JSON.stringify(manifest) + "\n");
  await verifyAcpRuntime(stage, target);
  await rename(stage, destination);
} finally {
  await rm(stage, { recursive: true, force: true });
}
