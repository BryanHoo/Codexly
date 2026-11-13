import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { verifyAcpRuntime } from "./acp-runtime-layout.mjs";

const tauri = fileURLToPath(new URL("../desktop/src-tauri/", import.meta.url));
const runtime = join(tauri, "resources/runtime");
void test("完整目标资源只包含一个 ACP sidecar，两种官方程序均可定位", async () => {
  const manifest = JSON.parse(await readFile(join(runtime, "manifest.json"), "utf8"));
  const suffix = manifest.platform === "win32" ? ".exe" : "";
  const triple = `${manifest.arch === "arm64" ? "aarch64" : "x86_64"}-${manifest.platform === "darwin" ? "apple-darwin" : manifest.platform === "win32" ? "pc-windows-msvc" : "unknown-linux-gnu"}`;
  const host = join(tauri, `binaries/acp-host-${triple}${suffix}`);
  await verifyAcpRuntime(runtime, manifest, host);
  assert.equal(manifest.host.placement, "sidecar");
  const entries = await readdir(runtime, { recursive: true });
  assert.equal(
    entries.some((entry) =>
      /\.gz$|\.tgz$|cache|node_modules|claude-host|(?:^|\/)acp-host(?:\.exe)?$/u.test(entry),
    ),
    false,
  );
  for (const engine of ["codex", "claude"]) {
    const binary = join(runtime, manifest.engines[engine].entrypoint);
    assert.ok((await stat(binary)).size > 0);
    if (manifest.platform === process.platform && manifest.arch === process.arch) {
      const result = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 15_000 });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.includes(manifest.engines[engine].version));
    }
  }
  assert.ok((await stat(host)).size > 0);
  if (manifest.platform === process.platform && manifest.arch === process.arch) {
    const result = spawnSync(host, ["--version"], { encoding: "utf8", timeout: 15_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /codexly-acp-host/u);
  }
});
