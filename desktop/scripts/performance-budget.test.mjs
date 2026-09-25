import assert from "node:assert/strict";
import test from "node:test";

import { analyzeBundle } from "./performance-budget.mjs";

void test("analyzeBundle separates initial and asynchronous chunks", () => {
  const manifest = {
    "src/main.tsx": { file: "assets/main.js", imports: ["vendor"], isEntry: true },
    scenario: {
      css: ["assets/scenario.css"],
      file: "assets/scenario.js",
      imports: ["vendor", "scenario-support"],
    },
    "scenario-support": { file: "assets/scenario-support.js", imports: [] },
    vendor: { file: "assets/vendor.js", imports: [] },
    source: { file: "assets/source.js", imports: ["vendor"], isDynamicEntry: true },
    "source-support": { file: "assets/source-support.js", imports: [] },
  };
  const sizes = new Map([
    ["assets/main.js", 100],
    ["assets/vendor.js", 200],
    ["assets/source.js", 300],
    ["assets/source-support.js", 450],
    ["assets/scenario.css", 25],
    ["assets/scenario.js", 400],
    ["assets/scenario-support.js", 50],
  ]);

  assert.deepEqual(analyzeBundle(manifest, sizes, { workspace: ["scenario"] }), {
    asyncChunks: [
      { bytes: 50, file: "assets/scenario-support.js" },
      { bytes: 400, file: "assets/scenario.js" },
      { bytes: 450, file: "assets/source-support.js" },
      { bytes: 300, file: "assets/source.js" },
    ],
    initialBytes: 300,
    initialChunks: [
      { bytes: 100, file: "assets/main.js" },
      { bytes: 200, file: "assets/vendor.js" },
    ],
    scenarios: {
      workspace: { bytes: 675, chunkCount: 4 },
    },
  });
});

void test("analyzeBundle rejects a missing scenario entry", () => {
  assert.throws(
    () => analyzeBundle({}, new Map(), { workspace: ["missing"] }),
    /Missing performance entry: missing/u,
  );
});
