import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import { cleanTauriTarget, resolveTauriTargetDirectory } from "./clean-tauri-target.mjs";
import { resolveTauriArguments, resolveTauriEnvironment } from "./tauri-build-constraints.mjs";

const tauriCli = fileURLToPath(
  new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url),
);

let argumentsList;
// 清理由本地打包命令显式启用；不把包装器参数传给 Tauri，也不改变正式构建默认行为。
const cleanTarget = process.argv.slice(2).includes("--clean-target");
const profile = process.env.CODEAGENT_MACOS_PROFILE || "modern";
try {
  argumentsList = resolveTauriArguments(
    process.argv.slice(2).filter((argument) => argument !== "--clean-target"),
    process.platform,
    process.arch,
    profile,
  );
  const signingEnvFile = fileURLToPath(new URL("../.env.signing.local", import.meta.url));
  // tauri:local 显式传入 --no-sign 和关闭更新产物的覆盖配置，因此不加载签名环境。
  if (
    process.platform === "darwin" &&
    ["build", "bundle"].includes(argumentsList[0]) &&
    !argumentsList.includes("--no-sign") &&
    existsSync(signingEnvFile)
  ) {
    // 本地签名身份从 Git 忽略文件读取；已导出的环境变量优先，CI 从 Secrets 注入。
    // 此文件不保存密码，开发和无签名测试也无需读取，避免影响其他平台。
    loadEnvFile(signingEnvFile);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const environment = {
  ...process.env,
  ...resolveTauriEnvironment(argumentsList, process.platform, profile),
  ...(process.platform === "darwin" && argumentsList[0] === "build"
    ? {
        // 兼容构建独立缓存，防止不同最低系统版本的本地依赖与安装包互相覆盖。
        ...(profile === "legacy"
          ? {
              CARGO_TARGET_DIR: fileURLToPath(
                new URL("../src-tauri/target/legacy", import.meta.url),
              ),
            }
          : {}),
      }
    : {}),
};
const result = spawnSync(process.execPath, [tauriCli, ...argumentsList], {
  stdio: "inherit",
  env: environment,
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
// 等待编译、签名和打包全部成功，再清理实际使用的缓存；失败时保留缓存以便重试。
if (cleanTarget && argumentsList[0] === "build" && result.status === 0) {
  try {
    await cleanTauriTarget(resolveTauriTargetDirectory(environment));
  } catch (error) {
    console.error(
      "本地构建已成功，但编译缓存清理失败：",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}
process.exit(result.status ?? 1);
