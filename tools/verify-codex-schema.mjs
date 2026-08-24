import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const generators = [
  { command: "generate-ts", directory: "typescript" },
  { command: "generate-json-schema", directory: "json-schema" },
];
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArguments(argv) {
  const options = { baselinePath: undefined, codexCliPath: undefined, update: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--update") {
      options.update = true;
      continue;
    }
    if (argument === "--baseline" || argument === "--codex-cli") {
      const value = argv[index + 1];
      if (!value) throw new Error(`Missing value for ${argument}`);
      if (argument === "--baseline") options.baselinePath = resolve(value);
      else options.codexCliPath = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function resolveCodexCli() {
  const require = createRequire(join(repositoryRoot, "package.json"));
  const manifestPath = require.resolve("@openai/codex/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const binPath = manifest.bin?.codex;
  if (typeof binPath !== "string" || binPath.length === 0) {
    throw new Error("@openai/codex does not expose the codex CLI");
  }
  return resolve(dirname(manifestPath), binPath);
}

function runCodex(codexCliPath, args) {
  const result = spawnSync(process.execPath, [codexCliPath, ...args], {
    encoding: "utf8",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.status}`;
    throw new Error(`Codex command failed: codex ${args.join(" ")}\n${detail}`);
  }
  return result.stdout.trim();
}

function readCodexVersion(codexCliPath) {
  const output = runCodex(codexCliPath, ["--version"]);
  const match = /^codex-cli (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(output);
  if (!match) throw new Error(`Unexpected Codex version output: ${output}`);
  return match[1];
}

function listFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).toSorted((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error(`Unsupported generated Schema entry: ${path}`);
    }
  };
  visit(root);
  return files;
}

function sortJsonKeys(value) {
  if (Array.isArray(value)) return value.map(sortJsonKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJsonKeys(child)]),
  );
}

function readNormalizedContent(path) {
  const content = readFileSync(path);
  if (!path.endsWith(".json")) return content;
  // Rust HashMap 的输出顺序不稳定；递归排序对象键，只忽略无语义的 JSON 排列差异。
  return JSON.stringify(sortJsonKeys(JSON.parse(content.toString("utf8"))));
}

function hashGeneratedFiles(root) {
  const entries = [];
  for (const path of listFiles(root)) {
    const relativePath = relative(root, path).split(sep).join("/");
    const hash = createHash("sha256").update(readNormalizedContent(path)).digest("hex");
    entries.push([relativePath, hash]);
  }
  return Object.fromEntries(entries.toSorted(([left], [right]) => left.localeCompare(right)));
}

function generateBaseline(codexCliPath, codexVersion) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "codexly-codex-schema-"));
  try {
    for (const generator of generators) {
      const outputDirectory = join(temporaryRoot, generator.directory);
      mkdirSync(outputDirectory, { recursive: true });
      // 项目使用 experimental API，基线必须覆盖同一协议面。
      runCodex(codexCliPath, [
        "app-server",
        generator.command,
        "--experimental",
        "--out",
        outputDirectory,
      ]);
    }
    return {
      schemaVersion: 1,
      codexVersion,
      experimental: true,
      generators: Object.fromEntries(
        generators
          .map(({ command }) => [command, "--experimental"])
          .toSorted(([left], [right]) => left.localeCompare(right)),
      ),
      files: hashGeneratedFiles(temporaryRoot),
    };
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

function diffFiles(expectedFiles, actualFiles) {
  const expectedPaths = new Set(Object.keys(expectedFiles));
  const actualPaths = new Set(Object.keys(actualFiles));
  return {
    added: [...actualPaths].filter((path) => !expectedPaths.has(path)).toSorted(),
    removed: [...expectedPaths].filter((path) => !actualPaths.has(path)).toSorted(),
    changed: [...actualPaths]
      .filter((path) => expectedPaths.has(path) && actualFiles[path] !== expectedFiles[path])
      .toSorted(),
  };
}

function formatDrift(codexVersion, drift) {
  const lines = [`Codex Schema drift detected for ${codexVersion}`];
  for (const path of drift.added) lines.push(`Added: ${path}`);
  for (const path of drift.removed) lines.push(`Removed: ${path}`);
  for (const path of drift.changed) lines.push(`Changed: ${path}`);
  lines.push("Run pnpm run codex:schema:update and review the baseline diff.");
  return lines.join("\n");
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const codexCliPath = options.codexCliPath ?? resolveCodexCli();
  const codexVersion = readCodexVersion(codexCliPath);
  const baselinePath =
    options.baselinePath ??
    join(repositoryRoot, "schemas", "codex-app-server", `${codexVersion}.schema-baseline.json`);
  const actual = generateBaseline(codexCliPath, codexVersion);

  if (options.update) {
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, `${JSON.stringify(actual, null, 2)}\n`);
    process.stdout.write(`Codex Schema baseline updated: ${codexVersion}\n`);
    return;
  }

  if (!existsSync(baselinePath)) {
    throw new Error(
      `Codex Schema baseline is missing for ${codexVersion}\nRun pnpm run codex:schema:update and review the baseline diff.`,
    );
  }
  const expected = JSON.parse(readFileSync(baselinePath, "utf8"));
  const metadataMatches =
    expected.schemaVersion === actual.schemaVersion &&
    expected.codexVersion === actual.codexVersion &&
    expected.experimental === actual.experimental &&
    JSON.stringify(expected.generators) === JSON.stringify(actual.generators);
  const drift = diffFiles(expected.files ?? {}, actual.files);
  if (
    !metadataMatches ||
    drift.added.length > 0 ||
    drift.removed.length > 0 ||
    drift.changed.length > 0
  ) {
    throw new Error(formatDrift(codexVersion, drift));
  }
  process.stdout.write(`Codex Schema baseline verified: ${codexVersion}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
