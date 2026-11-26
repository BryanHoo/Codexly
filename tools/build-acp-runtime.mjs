import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile, rm, rename, lstat, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { acpBuildTarget } from "./acp-build-target.mjs";
import {
  runtimeInventory,
  sha256,
  verifyAcpRuntime,
  resolveRuntimePackage,
} from "./acp-runtime-layout.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(join(root, "packages/provider-acp/package.json"));
const target = acpBuildTarget(
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
  const host = `acp-host${target.platform === "win32" ? ".exe" : ""}`;
  const build = spawnSync(
    process.execPath,
    [join(root, "tools/build-acp-host.mjs"), join(stage, host)],
    { cwd: root, stdio: "inherit", env: process.env },
  );
  if (build.status !== 0) throw build.error ?? new Error("ACP host build failed");
  const licenses = join(stage, "licenses");
  const acpSdkRoot = await resolveRuntimePackage(require, "@agentclientprotocol/sdk");
  await mkdir(licenses);
  await copyFile(join(acpSdkRoot, "LICENSE"), join(licenses, "ACP-SDK-LICENSE"));
  await copyFile(
    join(root, "tools/runtime-licenses/bun-LICENSE"),
    join(licenses, "BUN-LICENSE.md"),
  );
  const manifest = {
    schemaVersion: 1,
    platform: target.platform,
    arch: target.arch,
    host: { path: host, sha256: await sha256(join(stage, host)), protocolVersion: 1 },
    engines: {},
    files: await runtimeInventory(stage),
  };
  await writeFile(join(stage, "manifest.json"), JSON.stringify(manifest) + "\n");
  await verifyAcpRuntime(stage, target);
  await rename(stage, destination);
} finally {
  await rm(stage, { recursive: true, force: true });
}
