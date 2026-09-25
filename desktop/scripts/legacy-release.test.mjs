import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { legacyUpdateManifest } from "./legacy-release.mjs";

void test("Legacy preview metadata should preserve the prerelease version", () => {
  const manifest = legacyUpdateManifest("0.1.11-beta.1", "signature", "BryanHoo/Codexly", "v0.26.1-beta.1");
  assert.equal(manifest.version, "0.1.11-beta.1");
  assert.match(manifest.platforms["darwin-x86_64"].url, /v0\.26\.1-beta\.1\/Codexly_0\.1\.11-beta\.1_x64_legacy/);
});

void test("Legacy updates should reference only the signed Intel Legacy asset", () => {
  const manifest = legacyUpdateManifest("0.1.10", "signature", "BryanHoo/Codexly", "v0.26.1");
  assert.deepEqual(manifest.platforms, {
    "darwin-x86_64": {
      signature: "signature",
      url: "https://github.com/BryanHoo/Codexly/releases/download/v0.26.1/Codexly_0.1.10_x64_legacy.app.tar.gz",
    },
  });
  assert.throws(() => legacyUpdateManifest("0.1.10", "", "BryanHoo/Codexly", "v0.26.1"));
});

void test("desktop package uses its own Codexly app identity", async () => {
  const config = JSON.parse(await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  assert.equal(config.productName, "Codexly");
  assert.equal(config.mainBinaryName, "codexly");
  assert.equal(config.app.windows[0].title, "Codexly");
  assert.equal(config.identifier, "com.codexly.desktop");
});

void test("Modern and Legacy packages should never share an update manifest", async () => {
  const read = async (name) => JSON.parse(await readFile(new URL(`../src-tauri/${name}`, import.meta.url), "utf8"));
  const modern = await read("tauri.conf.json");
  const legacy = await read("tauri.macos-legacy.conf.json");
  assert.notDeepEqual(modern.plugins.updater.endpoints, legacy.plugins.updater.endpoints);
  assert.equal(legacy.bundle.macOS.minimumSystemVersion, "12.4");
  assert.equal(legacy.build.frontendDist, "../dist-legacy");
});
