import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { claudeBuildTarget } from "./claude-build-target.mjs";
import { resolveClaudeNativePackage, claudeNativeDistribution } from "./claude-native-package.mjs";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** CLI 版本来自 SDK 元数据，不能使用原生平台包的 SDK version。 */
export async function readClaudeCodeVersion(sdkEntry) {
  const { claudeCodeVersion } = JSON.parse(
    await readFile(new URL("./package.json", sdkEntry), "utf8"),
  );
  if (typeof claudeCodeVersion !== "string" || !claudeCodeVersion)
    throw new Error("Claude SDK package is missing claudeCodeVersion");
  return claudeCodeVersion;
}

async function buildClaudeHost() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const destination = join(root, "desktop/src-tauri/resources/claude");
  const target = claudeBuildTarget(
    process.env["CODEXLY_CLAUDE_TARGET"] ?? process.env["TAURI_ENV_TARGET_TRIPLE"],
  );
  const suffix = target.platform === "win32" ? ".exe" : "";
  const sdkEntry = import.meta.resolve("@anthropic-ai/claude-agent-sdk");
  const claudeCodeVersion = await readClaudeCodeVersion(sdkEntry);
  const nativePackage = await resolveClaudeNativePackage(root, sdkEntry, target);
  const manifest = JSON.parse(await readFile(nativePackage, "utf8"));
  const distribution = await claudeNativeDistribution(root, sdkEntry, target);
  if (manifest.version !== distribution.version)
    throw new Error("Claude native package does not match the installed SDK version");
  await mkdir(destination, { recursive: true });
  const bun = join(root, "node_modules/bun/bin/bun.exe");
  // Bun 只负责编译宿主；成品包含运行时，最终用户不需要安装 Node 或 Bun。
  const result = spawnSync(
    bun,
    [
      "build",
      "packages/provider-claude/src/host.ts",
      "packages/core/src/historical-attachment-worker.js",
      "--compile",
      "--root",
      ".",
      "--define",
      'CODEXLY_COMPILED_ATTACHMENT_WORKER="./packages/core/src/historical-attachment-worker.js"',
      `--target=bun-${target.platform === "win32" ? "windows" : target.platform}-${target.arch}`,
      "--define",
      `CODEXLY_CLAUDE_SDK_VERSION=${JSON.stringify(manifest.version)}`,
      "--minify",
      "--outfile",
      join(destination, `claude-host${suffix}`),
    ],
    { cwd: root, stdio: "inherit" },
  );
  if (result.status !== 0) throw result.error ?? new Error("Claude host compilation failed");
  const binary = join(destination, `claude${suffix}`);
  await copyFile(join(dirname(nativePackage), `claude${suffix}`), binary);
  for (const name of ["README.md", "LICENSE.md"])
    await copyFile(join(dirname(nativePackage), name), join(destination, name));
  await copyFile(
    join(dirname(fileURLToPath(sdkEntry)), "README.md"),
    join(destination, "SDK-README.md"),
  );
  const hostHash = createHash("sha256");
  for await (const chunk of createReadStream(join(destination, `claude-host${suffix}`)))
    hostHash.update(chunk);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(binary)) hash.update(chunk);
  // 构建清单只记录可复现的来源与摘要；运行时随安装包分发，无需单独压缩发布。
  const hostSha256 = hostHash.digest("hex");
  const binarySha256 = hash.digest("hex");
  const { version: appVersion } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  await writeFile(
    join(destination, "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      sdkVersion: manifest.version,
      claudeCodeVersion,
      platform: target.platform,
      arch: target.arch,
      native: {
        ...distribution,
        sha256: binarySha256,
      },
      host: {
        version: appVersion,
        sha256: hostSha256,
      },
    }) + "\n",
  );
  if (target.platform === process.platform && target.arch === process.arch) {
    const probe = spawnSync(join(destination, `claude-host${suffix}`), ["--version"], {
      encoding: "utf8",
    });
    if (probe.status !== 0 || !probe.stdout.includes(`sdk/${manifest.version}`))
      throw new Error("Compiled Claude host failed verification");
    console.log(probe.stdout.trim());
  }
}

// 导入版本读取函数的单元测试不触发宿主编译、下载或资源写入。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildClaudeHost();
}
