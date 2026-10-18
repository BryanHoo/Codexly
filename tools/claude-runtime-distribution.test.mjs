import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { claudeNativeDistribution } from "./claude-native-package.mjs";
import test from "node:test";

const root = new URL("../", import.meta.url);
test("desktop bundles only the staged target runtime resources", async () => {
  const config = JSON.parse(await readFile(new URL("desktop/src-tauri/tauri.conf.json", root)));
  assert.deepEqual(config.bundle.resources, { "resources/runtime/": "runtime/" });
  assert.deepEqual(config.bundle.externalBin, ["binaries/claude-host"]);
  const legacy = JSON.parse(
    await readFile(new URL("desktop/src-tauri/tauri.macos-legacy.conf.json", root)),
  );
  assert.deepEqual(legacy.bundle.externalBin, []);
});
test("generated distribution pins native and host dependencies independently", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("desktop/src-tauri/resources/claude/manifest.json", root)),
  );
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.native.version, manifest.sdkVersion);
  assert.match(manifest.native.integrity, /^[A-Za-z0-9+/]{86}==$/u);
  assert.match(manifest.native.url, /^https:\/\/registry.npmjs.org\//u);
  assert.equal(manifest.host.url, undefined);
  assert.match(manifest.host.sha256, /^[a-f0-9]{64}$/u);
});

test("SDK upgrades derive matching platform packages from the verified lockfile", async () => {
  const directory = await mkdtemp(join(tmpdir(), "claude-distribution-"));
  try {
    await writeFile(join(directory, "package.json"), JSON.stringify({ version: "9.9.9" }));
    const integrity = Buffer.alloc(64, 7).toString("base64");
    await writeFile(
      join(directory, "pnpm-lock.yaml"),
      `'@anthropic-ai/claude-agent-sdk-win32-x64@9.9.9':\n  resolution: {integrity: sha512-${integrity}}\n`,
    );
    const sdkEntry = pathToFileURL(join(directory, "sdk.mjs")).href;
    const target = { platform: "win32", arch: "x64" };
    const distribution = await claudeNativeDistribution(directory, sdkEntry, target);
    assert.equal(distribution.version, "9.9.9");
    assert.equal(distribution.integrity, integrity);
    assert.equal(
      distribution.url,
      "https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-win32-x64/-/claude-agent-sdk-win32-x64-9.9.9.tgz",
    );
    await writeFile(join(directory, "package.json"), JSON.stringify({ version: "10.0.0" }));
    await assert.rejects(
      claudeNativeDistribution(directory, sdkEntry, target),
      /verified lockfile/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
