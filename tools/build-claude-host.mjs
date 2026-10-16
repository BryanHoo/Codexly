import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { claudeBuildTarget } from "./claude-build-target.mjs";
import { resolveClaudeNativePackage } from "./claude-native-package.mjs";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const destination = join(root, "desktop/src-tauri/resources/claude");
const target = claudeBuildTarget(
  process.env["CODEXLY_CLAUDE_TARGET"] ?? process.env["TAURI_ENV_TARGET_TRIPLE"],
);
const suffix = target.platform === "win32" ? ".exe" : "";
const sdkEntry = import.meta.resolve("@anthropic-ai/claude-agent-sdk");
const nativePackage = await resolveClaudeNativePackage(root, sdkEntry, target);
const manifest = JSON.parse(await readFile(nativePackage, "utf8"));
if (manifest.version !== "0.3.300")
  throw new Error("Claude SDK native version differs from the adapter contract");
await mkdir(destination, { recursive: true });
const bun = join(root, "node_modules/bun/bin/bun.exe");
// Bun 只负责编译宿主；成品包含运行时，最终用户不需要安装 Node 或 Bun。
const result = spawnSync(
  bun,
  [
    "build",
    "packages/provider-claude/src/host.ts",
    "--compile",
    `--target=bun-${target.platform === "win32" ? "windows" : target.platform}-${target.arch}`,
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
await writeFile(
  join(destination, "manifest.json"),
  JSON.stringify({
    hostSha256: hostHash.digest("hex"),
    sdkVersion: manifest.version,
    platform: target.platform,
    arch: target.arch,
    binary: `claude${suffix}`,
    sha256: hash.digest("hex"),
  }) + "\n",
);
// Windows 便携版只分发主 EXE，将执行资源压缩嵌入，首次使用时原子解压。
if (target.platform === "win32") {
  for (const name of ["claude", "claude-host"])
    await pipeline(
      createReadStream(join(destination, `${name}.exe`)),
      createGzip({ level: 9 }),
      createWriteStream(join(destination, `${name}.gz`)),
    );
}
if (target.platform === process.platform && target.arch === process.arch) {
  const probe = spawnSync(join(destination, `claude-host${suffix}`), ["--version"], {
    encoding: "utf8",
  });
  if (probe.status !== 0 || !probe.stdout.includes("sdk/0.3.300"))
    throw new Error("Compiled Claude host failed verification");
  console.log(probe.stdout.trim());
}
