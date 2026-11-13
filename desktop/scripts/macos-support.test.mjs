import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { resolveTauriArguments, resolveTauriEnvironment } from "./tauri-build-constraints.mjs";

void test("desktop retires Legacy builds and keeps the supported macOS deployment target", async () => {
  assert.throws(() => resolveTauriArguments(["build"], "darwin", "x64", "legacy"), /unsupported|Unknown|不再支持/i);
  assert.equal(resolveTauriEnvironment(["build"], "darwin").MACOSX_DEPLOYMENT_TARGET, "14.5");
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  for (const key of ["build:legacy", "tauri:legacy", "test:legacy"]) assert.equal(manifest.scripts[key], undefined);
  await assert.rejects(access(new URL("../src-tauri/tauri.macos-legacy.conf.json", import.meta.url)));
  const workflow = await readFile(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8");
  assert.doesNotMatch(workflow, /latest-legacy|macos-legacy|macosProfile|_legacy/);
});
