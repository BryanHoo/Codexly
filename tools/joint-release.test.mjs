import assert from "node:assert/strict";
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

test("release notes publish both platforms at the same version", () => {
  const notes = formatJointReleaseNotes("v0.26.1", "0.26.1", "Web changes", "Desktop changes");
  assert.match(notes, /^<!-- codeagent-version: 0\.26\.1 -->\n/);
  assert.match(notes, /Codexly 0\.26\.1[\s\S]*Web changes/);
  assert.match(notes, /Codexly Desktop 0\.26\.1[\s\S]*Desktop changes/);
});
