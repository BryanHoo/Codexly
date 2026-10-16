import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeBuildTarget } from "./claude-build-target.mjs";
test("selects the release target instead of the compiler host architecture", () => {
  assert.deepEqual(claudeBuildTarget("x86_64-apple-darwin", "darwin", "arm64"), {
    platform: "darwin",
    arch: "x64",
  });
  assert.deepEqual(claudeBuildTarget("x86_64-pc-windows-msvc"), { platform: "win32", arch: "x64" });
  assert.deepEqual(claudeBuildTarget("aarch64-unknown-linux-gnu"), {
    platform: "linux",
    arch: "arm64",
  });
  assert.throws(() => claudeBuildTarget("universal-apple-darwin"));
});
