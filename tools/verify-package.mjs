import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

function verifyNativeDependencyInstall(name) {
  const manifestPath = require.resolve(`${name}/package.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const hasBindingConfig = existsSync(join(dirname(manifestPath), "binding.gyp"));
  const overridesImplicitInstall =
    manifest.gypfile === false ||
    Boolean(manifest.scripts?.preinstall) ||
    Boolean(manifest.scripts?.install);

  // npm 会为未声明安装钩子的 binding.gyp 包自动执行 node-gyp rebuild。
  if (hasBindingConfig && !overridesImplicitInstall) {
    throw new Error(
      `${name}@${manifest.version} triggers npm's implicit node-gyp rebuild during installation`,
    );
  }
}

const cliResult = spawnSync(process.execPath, ["dist/cli.js", "--help"], {
  encoding: "utf8",
  shell: false,
});

const packageManifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
if (packageManifest.bin?.["code-agent"] !== "dist/cli.js") {
  throw new Error(`Unexpected code-agent bin path: ${packageManifest.bin?.["code-agent"]}`);
}

if (cliResult.status !== 0 || !cliResult.stdout.includes("Usage: code-agent [command] [options]")) {
  process.stderr.write(cliResult.stderr);
  throw new Error("Built CLI is not executable");
}

verifyNativeDependencyInstall("better-sqlite3");

const packageManagerCli = process.env["npm_execpath"];
if (!packageManagerCli) {
  throw new Error("package:check must run through pnpm so npm_execpath is available");
}

const packRoot = mkdtempSync(join(tmpdir(), "code-agent-pack-check-"));
const stateRoot = mkdtempSync(join(tmpdir(), "code-agent-package-check-"));
try {
  // 必须生成真实 tarball，dry-run 无法验证发布时转换后的依赖协议。
  const result = spawnSync(
    process.execPath,
    [packageManagerCli, "pack", "--pack-destination", packRoot, "--json"],
    {
      encoding: "utf8",
      shell: false,
    },
  );

  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  const output = JSON.parse(result.stdout);
  // pnpm 返回单个对象；保留数组分支便于兼容不同打包器的 JSON 形态。
  const manifest = Array.isArray(output) ? output[0] : output;

  if (!manifest) {
    throw new Error("Package manifest is missing from pack output");
  }

  if (manifest.name !== "@bryanhu/code-agent") {
    throw new Error(`Unexpected package name: ${manifest.name}`);
  }

  const files = new Set(manifest.files.map(({ path }) => path));
  const requiredFiles = [
    "CHANGELOG.md",
    "dist/cli.js",
    "dist/codex-jsonl-frame-worker.js",
    "dist/server/index.js",
    "dist/sqlite-state-worker.js",
    "dist/web/index.html",
  ];
  const missingFiles = requiredFiles.filter((path) => !files.has(path));
  const sourceMapFiles = [...files].filter((path) => path.endsWith(".map"));

  if (missingFiles.length > 0) {
    throw new Error(`Package is missing required files: ${missingFiles.join(", ")}`);
  }

  if (sourceMapFiles.length > 0) {
    throw new Error(`Package must not include source maps: ${sourceMapFiles.join(", ")}`);
  }

  // 读取 tarball 内最终 package.json，防止 npm 客户端收到 pnpm 专用协议。
  const packedManifestResult = spawnSync(
    "tar",
    ["-xOf", manifest.filename, "package/package.json"],
    {
      encoding: "utf8",
      shell: false,
    },
  );
  if (packedManifestResult.status !== 0) {
    process.stderr.write(packedManifestResult.stderr);
    throw new Error("Unable to read package.json from packed tarball");
  }

  const packedManifest = JSON.parse(packedManifestResult.stdout);
  const dependencyFields = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ];
  const unresolvedDependencies = dependencyFields.flatMap((field) =>
    Object.entries(packedManifest[field] ?? {})
      .filter(([, version]) => /^(catalog|workspace):/.test(version))
      .map(([name, version]) => `${field}.${name}=${version}`),
  );
  if (unresolvedDependencies.length > 0) {
    throw new Error(
      `Package contains unresolved dependency protocols: ${unresolvedDependencies.join(", ")}`,
    );
  }

  // 发布校验必须真实启动 Worker，单纯检查文件清单无法发现相对路径错误。
  const { SqliteStateRepository } = await import("../dist/server/index.js");
  const repository = await SqliteStateRepository.open(join(stateRoot, "state.sqlite3"));
  await repository.close();

  process.stdout.write(`Package verified: ${manifest.filename} (${manifest.files.length} files)\n`);
} finally {
  rmSync(packRoot, { force: true, recursive: true });
  rmSync(stateRoot, { force: true, recursive: true });
}
