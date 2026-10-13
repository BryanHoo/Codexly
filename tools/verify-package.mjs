import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

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
if (packageManifest.bin?.["codexly"] !== "dist/cli.js") {
  throw new Error(`Unexpected codexly bin path: ${packageManifest.bin?.["codexly"]}`);
}

if (cliResult.status !== 0 || !cliResult.stdout.includes("Usage: codexly [command] [options]")) {
  process.stderr.write(cliResult.stderr);
  throw new Error("Built CLI is not executable");
}

// 发布产物也必须暴露自启动帮助，防止动态导入的 CLI 模块在打包后缺失。
for (const [args, expected] of [
  [["autostart", "--help"], "credentials"],
  [["autostart", "enable", "--help"], "--now"],
  [["start", "--help"], "--no-open"],
]) {
  const result = spawnSync(process.execPath, ["dist/cli.js", ...args], {
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0 || !result.stdout.includes(expected))
    throw new Error(`Built CLI help failed: ${args.join(" ")}`);
}

verifyNativeDependencyInstall("better-sqlite3");

const packageManagerCli = process.env["npm_execpath"];
if (!packageManagerCli) {
  throw new Error("package:check must run through pnpm so npm_execpath is available");
}

const packRoot = mkdtempSync(join(tmpdir(), "codexly-pack-check-"));
const stateRoot = mkdtempSync(join(tmpdir(), "codexly-package-check-"));
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

  if (manifest.name !== "@bryanhu/codexly") {
    throw new Error(`Unexpected package name: ${manifest.name}`);
  }

  const files = new Set(manifest.files.map(({ path }) => path));
  const requiredFiles = [
    "CHANGELOG.md",
    "docs/web-autostart.md",
    "docs/web-autostart.zh-CN.md",
    "dist/cli.js",
    "dist/codex-jsonl-frame-worker.js",
    "dist/historical-attachment-worker.js",
    "dist/server/index.js",
    "dist/sqlite-state-worker.js",
    "dist/scheduled-task-recurrence-worker.js",
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

  // 使用隔离配置启动真实 CLI：故意指定不存在的 Codex，验证后台失败可诊断、退出可回收且凭据不泄漏。
  // 此测试只运行内部入口，不注册或修改宿主系统的登录项。
  const autostartConfig = join(stateRoot, "config.json");
  const testPassword = "Package-Smoke_Lan123456";
  writeFileSync(
    autostartConfig,
    JSON.stringify({
      version: 1,
      node: process.execPath,
      cli: fileURLToPath(new URL("../dist/cli.js", import.meta.url)),
      home: stateRoot,
      environment: {},
      start: {
        noOpen: true,
        lan: true,
        lanPassword: testPassword,
        port: 3210,
        codexHome: stateRoot,
        codexBin: join(
          stateRoot,
          process.platform === "win32" ? "missing-codex.exe" : "missing-codex",
        ),
      },
    }),
    { mode: 0o600 },
  );
  const failedService = spawnSync(
    process.execPath,
    ["dist/cli.js", "autostart", "run", "--config", autostartConfig],
    {
      encoding: "utf8",
      shell: false,
      timeout: 20_000,
    },
  );
  const failedState = JSON.parse(readFileSync(join(stateRoot, "runtime.json"), "utf8"));
  const failedLog = readFileSync(join(stateRoot, "service.log"), "utf8");
  if (
    failedService.status !== 1 ||
    failedState.phase !== "failed" ||
    !failedState.error ||
    !failedLog.includes("missing-codex")
  ) {
    throw new Error(
      `Built autostart failure recovery failed: status=${String(failedService.status)}, phase=${failedState.phase}, error=${failedState.error ?? failedService.stderr}`,
    );
  }
  if (
    [failedService.stdout, failedService.stderr, JSON.stringify(failedState), failedLog].some(
      (text) => text.includes(testPassword),
    )
  ) {
    throw new Error("Built autostart leaked the saved LAN password");
  }

  // 发布校验必须真实启动 Worker，单纯检查文件清单无法发现相对路径错误。
  const { SqliteStateRepository } = await import("../dist/server/index.js");
  const repository = await SqliteStateRepository.open(join(stateRoot, "state.sqlite3"));
  await repository.close();

  // 实际启动附件 Worker 并写入正文，覆盖打包后的相对 URL、共享模块及异步文件流程。
  const attachmentWorker = new Worker(
    new URL("../dist/historical-attachment-worker.js", import.meta.url),
  );
  try {
    const text = "附件持久化发布验证";
    const response = once(attachmentWorker, "message", { signal: AbortSignal.timeout(5_000) });
    attachmentWorker.postMessage({
      operation: "persist",
      source: { type: "text", value: text },
      directory: join(stateRoot, "attachments"),
      kind: "text",
      maxBytes: 1_024,
      mediaType: "text/plain",
    });
    const [message] = await response;
    const result = message.result;
    if (
      result?.blobKey !== createHash("sha256").update(text).digest("hex") ||
      readFileSync(result.path, "utf8") !== text
    ) {
      throw new Error("Built attachment worker failed to persist verified bytes");
    }
  } finally {
    await attachmentWorker.terminate();
  }

  process.stdout.write(`Package verified: ${manifest.filename} (${manifest.files.length} files)\n`);
} finally {
  rmSync(packRoot, { force: true, recursive: true });
  rmSync(stateRoot, { force: true, recursive: true });
}
