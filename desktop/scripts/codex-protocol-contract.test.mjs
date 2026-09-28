import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const qualityWorkflow = await readFile(
  new URL("../../.github/workflows/desktop-quality.yml", import.meta.url),
  "utf8",
);
const desktopPackage = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

void test("桌面和 Web 共用根目录的 Codex Schema 基线", async () => {
  assert.equal(desktopPackage.scripts["codex:protocol:check"], "node ../tools/verify-codex-schema.mjs");
  assert.equal(
    desktopPackage.scripts["codex:protocol:update"],
    "node ../tools/verify-codex-schema.mjs --update",
  );
  const entries = await readdir(new URL("../schemas/codex-app-server/", import.meta.url), {
    recursive: true,
    withFileTypes: true,
  }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  assert.deepEqual(entries.filter((entry) => entry.isFile()), []);
});

void test("桌面 CI 安装工作区依赖并校验共享基线", () => {
  assert.match(
    qualityWorkflow,
    /name: Install dependencies\s+working-directory: \.\s+run: pnpm install --frozen-lockfile/u,
  );
  assert.match(qualityWorkflow, /pnpm codex:protocol:check/u);
  assert.doesNotMatch(qualityWorkflow, /npm install --global @openai\/codex/u);
});
