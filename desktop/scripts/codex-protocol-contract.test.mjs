import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  REQUIRED_CODEX_VERSION,
  assertCodexVersion,
  compareSchemaBundles,
  resolveCodexBinary,
  resolveCodexInvocation,
} from "./codex-protocol-contract.mjs";

const BUNDLES = [
  "codex_app_server_protocol.schemas.json",
  "codex_app_server_protocol.v2.schemas.json",
];
const qualityWorkflow = await readFile(
  new URL("../.github/workflows/quality.yml", import.meta.url),
  "utf8",
);

void test("requires the exact verified Codex version", () => {
  assert.equal(assertCodexVersion("codex-cli 0.156.0\n"), REQUIRED_CODEX_VERSION);
  assert.throws(
    () => assertCodexVersion("codex-cli 0.152.3\n"),
    /expected codex-cli 0\.156\.0/u,
  );
});

void test("resolves the npm Codex shim on Windows", () => {
  assert.equal(resolveCodexBinary("win32", undefined), "codex.cmd");
  assert.equal(resolveCodexBinary("linux", undefined), "codex");
  assert.equal(resolveCodexBinary("win32", " C:/tools/codex.exe "), "C:/tools/codex.exe");
  assert.deepEqual(
    resolveCodexInvocation(
      "win32",
      "codex.cmd",
      ["--version"],
      "C:/Windows/System32/cmd.exe",
    ),
    {
      file: "C:/Windows/System32/cmd.exe",
      args: ["/d", "/s", "/c", "codex.cmd", "--version"],
    },
  );
  assert.deepEqual(resolveCodexInvocation("win32", "C:/tools/codex.exe", ["--version"]), {
    file: "C:/tools/codex.exe",
    args: ["--version"],
  });
  assert.deepEqual(resolveCodexInvocation("linux", "codex", ["--version"]), {
    file: "codex",
    args: ["--version"],
  });
});

void test("runs the pinned protocol contract check in CI", () => {
  assert.ok(
    qualityWorkflow.includes(`npm install --global @openai/codex@${REQUIRED_CODEX_VERSION}`),
  );
  assert.match(qualityWorkflow, /pnpm codex:protocol:check/u);
});

void test("reports generated schema bundle differences", async () => {
  const root = await mkdtemp(join(tmpdir(), "codeagent-protocol-test-"));
  const expected = join(root, "expected");
  const generated = join(root, "generated");

  try {
    await Promise.all([mkdir(expected), mkdir(generated)]);
    await Promise.all(
      BUNDLES.flatMap((name) => [
        writeFile(join(expected, name), `${name}:verified\n`),
        writeFile(join(generated, name), `${name}:verified\n`),
      ]),
    );

    assert.deepEqual(await compareSchemaBundles(expected, generated), []);
    await writeFile(join(generated, BUNDLES[1]), "changed\n");
    assert.deepEqual(await compareSchemaBundles(expected, generated), [BUNDLES[1]]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
