import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { findSourceLineViolations } from "./source-lines.mjs";

void test("checks source and test files at the boundary while excluding data and deleted files", () => {
  const root = mkdtempSync(join(tmpdir(), "codeagent-source-lines-"));
  try {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/valid.ts"), "line\r\n".repeat(500));
    writeFileSync(join(root, "src/large.test.ts"), Array.from({ length: 501 }, () => "line").join("\n"));
    writeFileSync(join(root, "src/schema.json"), "line\n".repeat(800));
    assert.deepEqual(findSourceLineViolations(["src/valid.ts", "src/large.test.ts", "src/schema.json", "src/deleted.ts"], root), [
      { path: "src/large.test.ts", lines: 501 },
    ]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
