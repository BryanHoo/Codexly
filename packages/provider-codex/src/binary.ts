import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, posix, resolve, win32 } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const SUPPORTED_CODEX_VERSION = "0.153.4";
export const SUPPORTED_CODEX_VERSION_RANGE = ">=0.153.4,<0.154.0";

interface BundledCodexTarget {
  executableName: string;
  packageName: string;
  targetTriple: string;
}

// 与固定版本 Codex launcher 的平台映射保持一致，直接管理原生进程。
const BUNDLED_CODEX_TARGETS: Readonly<Record<string, BundledCodexTarget>> = {
  "darwin-arm64": {
    executableName: "codex",
    packageName: "@openai/codex-darwin-arm64",
    targetTriple: "aarch64-apple-darwin",
  },
  "darwin-x64": {
    executableName: "codex",
    packageName: "@openai/codex-darwin-x64",
    targetTriple: "x86_64-apple-darwin",
  },
  "linux-arm64": {
    executableName: "codex",
    packageName: "@openai/codex-linux-arm64",
    targetTriple: "aarch64-unknown-linux-musl",
  },
  "linux-x64": {
    executableName: "codex",
    packageName: "@openai/codex-linux-x64",
    targetTriple: "x86_64-unknown-linux-musl",
  },
  "win32-arm64": {
    executableName: "codex.exe",
    packageName: "@openai/codex-win32-arm64",
    targetTriple: "aarch64-pc-windows-msvc",
  },
  "win32-x64": {
    executableName: "codex.exe",
    packageName: "@openai/codex-win32-x64",
    targetTriple: "x86_64-pc-windows-msvc",
  },
};

export type CodexBinarySource = "explicit" | "environment" | "bundled" | "path";

export interface CodexBinary {
  path: string;
  source: CodexBinarySource;
}

export interface CodexVersionInfo {
  raw: string;
  version: string;
}

export interface CheckCodexVersionOptions {
  execute?: (binaryPath: string) => Promise<string>;
}

export interface LocateCodexBinaryOptions {
  explicitPath?: string;
  env?: NodeJS.ProcessEnv;
  bundledBinaryPath?: string | null;
  platform?: NodeJS.Platform;
}

function resolveBundledBinary(platform: NodeJS.Platform): string | null {
  const targetKey = `${platform}-${process.arch}`;
  const target = BUNDLED_CODEX_TARGETS[targetKey];
  if (!target) {
    return null;
  }

  try {
    const rootRequire = createRequire(import.meta.url);
    const codexPackagePath = rootRequire.resolve("@openai/codex/package.json");
    const codexRequire = createRequire(codexPackagePath);
    const platformPackagePath = codexRequire.resolve(`${target.packageName}/package.json`);
    return resolve(
      dirname(platformPackagePath),
      "vendor",
      target.targetTriple,
      "bin",
      target.executableName,
    );
  } catch {
    return null;
  }
}

async function isExecutable(filePath: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    await access(filePath, platform === "win32" ? undefined : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function pathCandidateNames(platform: NodeJS.Platform): readonly string[] {
  return platform === "win32" ? ["codex.exe"] : ["codex"];
}

function readEnvironmentValue(
  env: NodeJS.ProcessEnv,
  name: string,
  platform: NodeJS.Platform,
): string | undefined {
  const direct = env[name];
  if (direct !== undefined || platform !== "win32") {
    return direct;
  }
  // Windows 环境变量名不区分大小写，复制 process.env 后也要保留该语义。
  return Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
}

async function findOnPath(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<string | null> {
  const pathApi = platform === "win32" ? win32 : posix;
  const directories = (readEnvironmentValue(env, "PATH", platform) ?? "")
    .split(pathApi.delimiter)
    .filter(Boolean);
  for (const directory of directories) {
    for (const candidateName of pathCandidateNames(platform)) {
      const candidate = pathApi.join(directory, candidateName);
      if (await isExecutable(candidate, platform)) {
        return candidate;
      }
    }
  }
  return null;
}

async function requireExecutable(
  path: string,
  source: CodexBinarySource,
  platform: NodeJS.Platform,
): Promise<CodexBinary> {
  const resolvedPath = resolve(path);
  if (platform === "win32" && !resolvedPath.toLowerCase().endsWith(".exe")) {
    throw new Error("Windows Codex binary must be a native .exe executable");
  }
  if (!(await isExecutable(resolvedPath, platform))) {
    throw new Error(`Codex binary is not executable: ${resolvedPath}`);
  }
  return { path: resolvedPath, source };
}

export async function locateCodexBinary(
  options: LocateCodexBinaryOptions = {},
): Promise<CodexBinary> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;

  if (options.explicitPath) {
    return requireExecutable(options.explicitPath, "explicit", platform);
  }
  const environmentPath = readEnvironmentValue(env, "CODEXLY_CODEX_BIN", platform);
  if (environmentPath) {
    return requireExecutable(environmentPath, "environment", platform);
  }

  // 包内固定版本优先，避免用户 PATH 中的 Codex 协议发生漂移。
  const bundledPath =
    options.bundledBinaryPath === undefined
      ? resolveBundledBinary(platform)
      : options.bundledBinaryPath;
  if (bundledPath && (await isExecutable(bundledPath, platform))) {
    return { path: resolve(bundledPath), source: "bundled" };
  }

  const pathBinary = await findOnPath(env, platform);
  if (pathBinary) {
    return { path: resolve(pathBinary), source: "path" };
  }

  throw new Error(
    `Codex binary was not found; install @openai/codex@${SUPPORTED_CODEX_VERSION} or configure --codex-bin`,
  );
}

async function executeCodexVersion(binaryPath: string): Promise<string> {
  const { stdout } = await execFileAsync(binaryPath, ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  });
  return stdout;
}

export async function checkCodexVersion(
  binaryPath: string,
  options: CheckCodexVersionOptions = {},
): Promise<CodexVersionInfo> {
  let stdout: string;
  try {
    stdout = await (options.execute ?? executeCodexVersion)(binaryPath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Codex version check failed: ${reason}`, { cause: error });
  }

  const raw = stdout.trim();
  const match = /^codex-cli (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(raw);
  const version = match?.[1];
  if (!version) {
    throw new Error(`Invalid Codex version output: ${raw || "<empty>"}`);
  }
  const [major, minor, patch] = version.split("-", 1)[0]?.split(".").map(Number) ?? [];
  const isPrerelease = version.includes("-");
  // experimentalApi 只允许经过契约验证的 0.153.4+ 补丁线，拒绝旧协议与未知次版本。
  if (major !== 0 || minor !== 153 || patch === undefined || patch < 4 || isPrerelease) {
    throw new Error(
      `Unsupported Codex version ${version}; expected ${SUPPORTED_CODEX_VERSION_RANGE}`,
    );
  }

  return { raw, version };
}
