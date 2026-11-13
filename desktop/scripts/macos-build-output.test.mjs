import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
const root = new URL("../", import.meta.url);

void test("Modern output should exclude Legacy renderers and polyfills", async () => {
  const files = await readdir(new URL("dist/assets/", root));
  assert.ok(!files.some((name) => name.startsWith("polyfills-")));
  const manifest = JSON.parse(await readFile(new URL("dist/.vite/manifest.json", root), "utf8"));
  assert.ok(Object.keys(manifest).every((key) => !key.includes("compat/macos-legacy")));
  const sourcePanel = files.find((name) => /^project-source-panel-.*\.js$/.test(name));
  assert.ok(sourcePanel);
  const source = await readFile(new URL(`dist/assets/${sourcePanel}`, root), "utf8");
  assert.doesNotMatch(source, /legacy-code-token|VITE_MACOS_LEGACY/);
});
