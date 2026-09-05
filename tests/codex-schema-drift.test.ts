import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const checkerPath = join(process.cwd(), "tools/verify-codex-schema.mjs");
const temporaryRoots: string[] = [];

function createFakeCodexCli() {
  const root = mkdtempSync(join(tmpdir(), "codexly-codex-schema-test-"));
  temporaryRoots.push(root);
  const cliPath = join(root, "fake-codex.mjs");
  writeFileSync(
    cliPath,
    `
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write("codex-cli 0.153.4\\n");
  process.exit(0);
}

const generator = args[1];
const outputIndex = args.indexOf("--out");
const output = args[outputIndex + 1];
if (args[0] !== "app-server" || outputIndex < 0 || !args.includes("--experimental") || !output) {
  process.stderr.write(\`Unexpected arguments: \${args.join(" ")}\\n\`);
  process.exit(2);
}

mkdirSync(output, { recursive: true });
const variant = process.env["FAKE_CODEX_SCHEMA_VARIANT"] ?? "baseline";
if (generator === "generate-ts") {
  writeFileSync(join(output, "index.ts"), variant === "drift" ? "export type Value = string;\\n" : "export type Value = number;\\n");
  if (variant !== "drift") writeFileSync(join(output, "removed.ts"), "export type Removed = true;\\n");
  if (variant === "drift") writeFileSync(join(output, "added.ts"), "export type Added = true;\\n");
} else if (generator === "generate-json-schema") {
  const schema = variant === "json-order"
    ? { type: "object", properties: { b: { type: "string" }, a: { type: "number" } } }
    : { properties: { a: { type: "number" }, b: { type: "string" } }, type: "object" };
  writeFileSync(join(output, "protocol.json"), JSON.stringify(schema));
} else {
  process.stderr.write(\`Unexpected generator: \${generator}\\n\`);
  process.exit(2);
}
`,
  );
  return { baselinePath: join(root, "baseline.json"), cliPath };
}

function createNativeFakeCodexCli() {
  const fixture = createFakeCodexCli();
  const launcherPath = join(fixture.cliPath, "..", "fake-codex");
  writeFileSync(
    launcherPath,
    `#!/bin/sh
exec "${process.execPath}" "${fixture.cliPath}" "$@"
`,
  );
  chmodSync(launcherPath, 0o755);
  return { ...fixture, cliPath: launcherPath };
}

function runChecker(
  cliPath: string,
  baselinePath: string,
  options: Readonly<{ fromEnvironment?: boolean; update?: boolean; variant?: string }> = {},
) {
  return spawnSync(
    process.execPath,
    [
      checkerPath,
      ...(options.fromEnvironment === true ? [] : ["--codex-cli", cliPath]),
      "--baseline",
      baselinePath,
      ...(options.update === true ? ["--update"] : []),
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ...(options.fromEnvironment === true ? { CODEXLY_CODEX_BIN: cliPath } : {}),
        ...(options.variant === undefined ? {} : { FAKE_CODEX_SCHEMA_VARIANT: options.variant }),
      },
    },
  );
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("Codex Schema 漂移门禁", () => {
  it.skipIf(process.platform === "win32")("支持直接执行原生 Codex CLI", () => {
    const { baselinePath, cliPath } = createNativeFakeCodexCli();

    const result = runChecker(cliPath, baselinePath, { update: true });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Codex Schema baseline updated: 0.153.4");
  });

  it("优先使用 CODEXLY_CODEX_BIN 指定的 Codex CLI", () => {
    const { baselinePath, cliPath } = createFakeCodexCli();

    const result = runChecker(cliPath, baselinePath, { fromEnvironment: true, update: true });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Codex Schema baseline updated: 0.153.4");
  });

  it("显式更新并验证包含实验 API 的规范化基线", () => {
    const { baselinePath, cliPath } = createFakeCodexCli();

    const updateResult = runChecker(cliPath, baselinePath, { update: true });
    const verifyResult = runChecker(cliPath, baselinePath);
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as {
      codexVersion: string;
      experimental: boolean;
      files: Record<string, string>;
      generators: Record<string, string>;
    };

    expect(updateResult.status).toBe(0);
    expect(updateResult.stdout).toContain("Codex Schema baseline updated: 0.153.4");
    expect(verifyResult.status).toBe(0);
    expect(verifyResult.stdout).toContain("Codex Schema baseline verified: 0.153.4");
    expect(baseline).toMatchObject({
      codexVersion: "0.153.4",
      experimental: true,
      generators: {
        "generate-json-schema": "--experimental",
        "generate-ts": "--experimental",
      },
    });
    expect(Object.keys(baseline.files)).toEqual([
      "json-schema/protocol.json",
      "typescript/index.ts",
      "typescript/removed.ts",
    ]);
    expect(Object.values(baseline.files)).toSatisfy((hashes: string[]) =>
      hashes.every((hash) => /^[a-f0-9]{64}$/.test(hash)),
    );
  });

  it("拒绝新增、删除和内容变化的生成结果", () => {
    const { baselinePath, cliPath } = createFakeCodexCli();
    expect(runChecker(cliPath, baselinePath, { update: true }).status).toBe(0);

    const result = runChecker(cliPath, baselinePath, { variant: "drift" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Codex Schema drift detected for 0.153.4");
    expect(result.stderr).toContain("Added: typescript/added.ts");
    expect(result.stderr).toContain("Removed: typescript/removed.ts");
    expect(result.stderr).toContain("Changed: typescript/index.ts");
  });

  it("忽略 JSON Schema 对象键顺序变化", () => {
    const { baselinePath, cliPath } = createFakeCodexCli();
    expect(runChecker(cliPath, baselinePath, { update: true }).status).toBe(0);

    const result = runChecker(cliPath, baselinePath, { variant: "json-order" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Codex Schema baseline verified: 0.153.4");
  });

  it("缺少当前 Codex 版本基线时拒绝校验", () => {
    const { baselinePath, cliPath } = createFakeCodexCli();

    const result = runChecker(cliPath, baselinePath);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Codex Schema baseline is missing for 0.153.4");
    expect(result.stderr).toContain("pnpm run codex:schema:update");
  });
});
