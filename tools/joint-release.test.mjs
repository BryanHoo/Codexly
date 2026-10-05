import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { formatJointReleaseNotes, validateJointRelease } from "./joint-release.mjs";

test("one release tag requires identical web and desktop versions", () => {
  assert.deepEqual(validateJointRelease("v0.26.1", "0.26.1", "0.26.1"), {
    desktopVersion: "0.26.1",
    webVersion: "0.26.1",
  });
  assert.throws(() => validateJointRelease("v0.26.0", "0.26.1", "0.26.1"), /release tag/);
  assert.throws(() => validateJointRelease("v0.26.1", "0.26.1", "0.2.6"), /desktop version/);
});

test("release notes publish one unified body for both platforms", () => {
  const changes = "### 新增\n\n- Web 与桌面端共用历史压缩";
  const notes = formatJointReleaseNotes("v0.26.1", "0.26.1", changes);
  assert.equal(notes, `<!-- codeagent-version: 0.26.1 -->\n# Codexly 0.26.1\n\n${changes}\n`);
});

test("release CLI reads only the root changelog", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codexly-release-"));
  try {
    const output = join(directory, "notes.md");
    const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
    execFileSync(process.execPath, ["tools/joint-release.mjs", "--notes", output], {
      env: { ...process.env, RELEASE_TAG: `v${version}` },
    });
    const notes = await readFile(output, "utf8");
    assert.equal(notes.match(/^# /gm)?.length, 1);
    assert.doesNotMatch(notes, /Codexly Desktop|undefined/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
