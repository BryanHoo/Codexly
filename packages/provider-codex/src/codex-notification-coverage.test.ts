import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  CODEX_IGNORED_NOTIFICATION_METHODS,
  CODEX_MAPPED_NOTIFICATION_METHODS,
  CODEX_NOTIFICATION_METHODS,
  CODEX_OPT_OUT_NOTIFICATION_METHODS,
  CODEX_SPECIAL_NOTIFICATION_METHODS,
} from "./codex-mapping-common.js";

const temporaryRoot = mkdtempSync(join(tmpdir(), "codexly-notification-coverage-"));

afterAll(() => {
  rmSync(temporaryRoot, { force: true, recursive: true });
});

function generateOfficialNotificationMethods(): Set<string> {
  const configuredCliPath = process.env["CODEXLY_CODEX_BIN"];
  const cliPath = configuredCliPath ?? resolveBundledCodexCli();
  const extension = extname(cliPath).toLowerCase();
  const isJavaScriptLauncher = extension === ".js" || extension === ".mjs" || extension === ".cjs";
  const result = spawnSync(
    isJavaScriptLauncher ? process.execPath : cliPath,
    [
      ...(isJavaScriptLauncher ? [cliPath] : []),
      "app-server",
      "generate-ts",
      "--experimental",
      "--out",
      temporaryRoot,
    ],
    { encoding: "utf8", shell: false },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "Codex TypeScript schema generation failed");
  }
  const source = readFileSync(join(temporaryRoot, "ServerNotification.ts"), "utf8");
  return new Set([...source.matchAll(/"method": "([^"]+)"/gu)].map((match) => match[1] ?? ""));
}

function resolveBundledCodexCli(): string {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve("@openai/codex/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    bin?: { codex?: string };
  };
  const binPath = manifest.bin?.codex;
  if (binPath === undefined) throw new Error("@openai/codex does not expose the codex CLI");
  return resolve(dirname(manifestPath), binPath);
}

describe("Codex notification coverage", () => {
  it("classifies every generated ServerNotification exactly once", () => {
    const officialMethods = generateOfficialNotificationMethods();
    const classifications = [
      CODEX_MAPPED_NOTIFICATION_METHODS,
      CODEX_SPECIAL_NOTIFICATION_METHODS,
      CODEX_IGNORED_NOTIFICATION_METHODS,
    ];
    const duplicates = [...officialMethods].filter(
      (method) =>
        classifications.filter((classification) => classification.has(method)).length !== 1,
    );

    expect(duplicates).toEqual([]);
    expect(CODEX_NOTIFICATION_METHODS).toEqual(officialMethods);
  });

  it("opts out every notification that the product intentionally ignores", () => {
    expect(CODEX_OPT_OUT_NOTIFICATION_METHODS).toEqual(
      [...CODEX_IGNORED_NOTIFICATION_METHODS].sort(),
    );
    expect(
      CODEX_OPT_OUT_NOTIFICATION_METHODS.filter((method) =>
        CODEX_SPECIAL_NOTIFICATION_METHODS.has(method),
      ),
    ).toEqual([]);
  });

  it("keeps native file search session notifications enabled", () => {
    expect(CODEX_SPECIAL_NOTIFICATION_METHODS.has("fuzzyFileSearch/sessionUpdated")).toBe(true);
    expect(CODEX_SPECIAL_NOTIFICATION_METHODS.has("fuzzyFileSearch/sessionCompleted")).toBe(true);
    expect(CODEX_OPT_OUT_NOTIFICATION_METHODS).not.toContain("fuzzyFileSearch/sessionUpdated");
    expect(CODEX_OPT_OUT_NOTIFICATION_METHODS).not.toContain("fuzzyFileSearch/sessionCompleted");
  });

  it("keeps native filesystem change notifications enabled", () => {
    expect(CODEX_SPECIAL_NOTIFICATION_METHODS.has("fs/changed")).toBe(true);
    expect(CODEX_OPT_OUT_NOTIFICATION_METHODS).not.toContain("fs/changed");
  });

  it("negotiates structured file patches as the only realtime diff source", () => {
    expect(CODEX_MAPPED_NOTIFICATION_METHODS.has("item/fileChange/patchUpdated")).toBe(true);
    expect(CODEX_IGNORED_NOTIFICATION_METHODS.has("turn/diff/updated")).toBe(true);
    expect(CODEX_OPT_OUT_NOTIFICATION_METHODS).toContain("turn/diff/updated");
  });

  it("explicitly opts out of 0.153.4 model provider auth recovery notifications", () => {
    expect(CODEX_IGNORED_NOTIFICATION_METHODS.has("modelProvider/authRecoveryStarted")).toBe(true);
    expect(CODEX_IGNORED_NOTIFICATION_METHODS.has("modelProvider/authRecoveryCompleted")).toBe(
      true,
    );
    expect(CODEX_OPT_OUT_NOTIFICATION_METHODS).toContain("modelProvider/authRecoveryStarted");
    expect(CODEX_OPT_OUT_NOTIFICATION_METHODS).toContain("modelProvider/authRecoveryCompleted");
  });
});
