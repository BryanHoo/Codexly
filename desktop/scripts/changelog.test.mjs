import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { extractReleaseNotes } from "../../tools/extract-release-notes.mjs";

const changelog = await readFile(new URL("../../CHANGELOG.md", import.meta.url), "utf8");
const releaseWorkflow = await readFile(
  new URL("../../.github/workflows/release.yml", import.meta.url),
  "utf8",
);

void test("extracts the dated changelog section for a release", () => {
  const notes = extractReleaseNotes(changelog, "0.30.0");

  assert.match(notes, /^### 新增$/m);
  assert.match(notes, /Web 与桌面端共用交互式图片预览/u);
  assert.match(notes, /^### 修复$/m);
  assert.match(notes, /终端关闭清理/u);
  assert.doesNotMatch(notes, /^## \[Unreleased\]$/m);
});

void test("rejects a release version missing from the changelog", () => {
  assert.throws(() => extractReleaseNotes(changelog, "9.9.9"), /9\.9\.9/);
});

void test("publishes the matching changelog section as the GitHub release body", () => {
  assert.match(releaseWorkflow, /node \.\/tools\/joint-release\.mjs --notes/);
  assert.match(releaseWorkflow, /gh release edit .* --notes-file/);
});
