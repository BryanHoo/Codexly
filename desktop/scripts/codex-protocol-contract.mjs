import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_CODEX_VERSION = "0.156.0";
export const SCHEMA_BUNDLES = [
  "codex_app_server_protocol.schemas.json",
  "codex_app_server_protocol.v2.schemas.json",
];

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotDirectory = resolve(
  workspaceRoot,
  "schemas/codex-app-server",
  REQUIRED_CODEX_VERSION,
);

export function assertCodexVersion(output) {
  const expected = `codex-cli ${REQUIRED_CODEX_VERSION}`;
  const actual = output.trim();

  if (actual !== expected) {
    throw new Error(`expected ${expected}, received ${actual || "empty output"}`);
  }
  return REQUIRED_CODEX_VERSION;
}

export function resolveCodexBinary(platform, configuredBinary) {
  return configuredBinary?.trim() || (platform === "win32" ? "codex.cmd" : "codex");
}

export function resolveCodexInvocation(
  platform,
  codexBinary,
  args,
  commandShell = process.env.ComSpec || "cmd.exe",
) {
  if (platform === "win32" && /\.(?:cmd|bat)$/iu.test(codexBinary)) {
    return {
      file: commandShell,
      args: ["/d", "/s", "/c", codexBinary, ...args],
    };
  }

  return { file: codexBinary, args };
}

function execCodexFileSync(codexBinary, args, options) {
  const invocation = resolveCodexInvocation(process.platform, codexBinary, args);
  return execFileSync(invocation.file, invocation.args, options);
}

export async function compareSchemaBundles(expectedDirectory, generatedDirectory) {
  const comparisons = await Promise.all(
    SCHEMA_BUNDLES.map(async (name) => {
      try {
        const [expected, generated] = await Promise.all([
          readFile(join(expectedDirectory, name)),
          readFile(join(generatedDirectory, name)),
        ]);
        return expected.equals(generated) ? null : name;
      } catch {
        return name;
      }
    }),
  );

  return comparisons.filter((name) => name !== null);
}

async function generateSchemaBundles(codexBinary, outputDirectory) {
  const versionOutput = execCodexFileSync(codexBinary, ["--version"], {
    encoding: "utf8",
  });
  assertCodexVersion(versionOutput);

  // 项目启用了 experimentalApi，快照必须包含当前版本的实验协议。
  execCodexFileSync(
    codexBinary,
    [
      "app-server",
      "generate-json-schema",
      "--experimental",
      "--out",
      outputDirectory,
    ],
    { stdio: "inherit" },
  );
}

async function writeSnapshots(generatedDirectory) {
  await mkdir(snapshotDirectory, { recursive: true });
  await Promise.all(
    SCHEMA_BUNDLES.map((name) =>
      copyFile(join(generatedDirectory, name), join(snapshotDirectory, name)),
    ),
  );
}

async function main() {
  const write = process.argv.slice(2).includes("--write");
  const codexBinary = resolveCodexBinary(process.platform, process.env.CODEX_BIN);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "codeagent-codex-schema-"));

  try {
    await generateSchemaBundles(codexBinary, temporaryDirectory);
    if (write) {
      await writeSnapshots(temporaryDirectory);
      process.stdout.write(`updated Codex ${REQUIRED_CODEX_VERSION} schema snapshots\n`);
      return;
    }

    const differences = await compareSchemaBundles(snapshotDirectory, temporaryDirectory);
    if (differences.length > 0) {
      throw new Error(
        `Codex protocol schema drift detected: ${differences.join(", ")}. ` +
          `Run pnpm codex:protocol:update with codex-cli ${REQUIRED_CODEX_VERSION} and review the diff.`,
      );
    }
    process.stdout.write(`Codex ${REQUIRED_CODEX_VERSION} protocol schema is unchanged\n`);
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
