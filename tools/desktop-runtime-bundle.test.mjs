import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { verifyAcpRuntime } from "./acp-runtime-layout.mjs";

const tauri = fileURLToPath(new URL("../desktop/src-tauri/", import.meta.url));
const runtime = join(tauri, "resources/runtime");
void test("桌面资源只分发 ACP sidecar 与运行时清单和许可证", async () => {
  const manifest = JSON.parse(await readFile(join(runtime, "manifest.json"), "utf8"));
  const suffix = manifest.platform === "win32" ? ".exe" : "";
  const triple = `${manifest.arch === "arm64" ? "aarch64" : "x86_64"}-${manifest.platform === "darwin" ? "apple-darwin" : manifest.platform === "win32" ? "pc-windows-msvc" : "unknown-linux-gnu"}`;
  const host = join(tauri, `binaries/acp-host-${triple}${suffix}`);
  await verifyAcpRuntime(runtime, manifest, host);
  assert.equal(manifest.host.placement, "sidecar");
  // 直接核对新安装包的文件清单，防止工作区残留资源让旧原生程序重新进入发布包。
  assert.deepEqual(manifest.engines, {});
  assert.deepEqual((await readdir(runtime)).sort(), ["licenses", "manifest.json"]);
  assert.deepEqual((await readdir(join(runtime, "licenses"))).sort(), [
    "ACP-SDK-LICENSE",
    "BUN-LICENSE.md",
  ]);
  assert.ok((await stat(host)).size > 0);
  if (manifest.platform === process.platform && manifest.arch === process.arch) {
    const result = spawnSync(host, ["--version"], { encoding: "utf8", timeout: 15_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /codexly-acp-host/u);
  }
});
