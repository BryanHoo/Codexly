import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const tauri = fileURLToPath(new URL("../desktop/src-tauri/", import.meta.url));
const runtime = join(tauri, "resources/runtime");
test("bundle contains the complete target Codex layout and exactly one Claude host", async () => {
  const manifest = JSON.parse(await readFile(join(runtime, "manifest.json"), "utf8"));
  const suffix = manifest.platform === "win32" ? ".exe" : "";
  const triple = `${manifest.arch === "arm64" ? "aarch64" : "x86_64"}-${manifest.platform === "darwin" ? "apple-darwin" : manifest.platform === "win32" ? "pc-windows-msvc" : "unknown-linux-gnu"}`;
  const entries = await readdir(runtime, { recursive: true });
  assert.equal(
    entries.some((entry) => /\.gz$|\.tgz$|cache|node_modules|claude-host/u.test(entry)),
    false,
  );
  const codex = join(runtime, `codex/bin/codex${suffix}`);
  for (const binary of [
    codex,
    join(runtime, `codex/bin/codex-code-mode-host${suffix}`),
    join(runtime, `codex/codex-path/rg${suffix}`),
  ]) {
    assert.ok((await stat(binary)).size > 0);
  }
  if (process.env.CODEAGENT_MACOS_PROFILE !== "legacy") {
    assert.ok((await stat(join(runtime, `claude/claude${suffix}`))).size > 0);
    const host = join(tauri, `binaries/claude-host-${triple}${suffix}`);
    assert.ok((await stat(host)).size > 0);
    if (manifest.platform === process.platform && manifest.arch === process.arch) {
      const result = spawnSync(host, ["--version"], { encoding: "utf8", timeout: 15_000 });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /codexly-claude-host/u);
    }
  }
  if (manifest.platform === process.platform && manifest.arch === process.arch) {
    const result = spawnSync(codex, ["--version"], { encoding: "utf8", timeout: 15_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), `codex-cli ${manifest.codexVersion}`);
  }
});
