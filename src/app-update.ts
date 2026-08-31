import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, parse, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AppInfoResponse,
  AppUpdateProgress,
  AppUpdateProgressResponse,
  InstallAppUpdateResponse,
} from "@codexly/protocol";

const PACKAGE_NAME = "@bryanhu/codexly";
const INITIAL_APP_VERSION = "0.1.0";
const CHANGELOG_URL_PREFIX = "https://raw.githubusercontent.com/BryanHoo/Codexly/v";
const REGISTRY_TIMEOUT_MS = 10_000;
const MAX_RELEASE_NOTES_BYTES = 32 * 1024;
const INSTALL_TIMEOUT_MS = 2 * 60_000;
const SEMANTIC_VERSION_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:(?:0|[1-9][0-9]*)|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:(?:0|[1-9][0-9]*)|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

type AppUpdateErrorCode = "UPDATE_CHECK_FAILED" | "UPDATE_INSTALL_FAILED" | "UPDATE_NOT_AVAILABLE";

export class AppUpdateError extends Error {
  public constructor(
    public readonly code: AppUpdateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppUpdateError";
  }
}

export interface AppUpdateService {
  install: (
    version: string,
    onProgress?: (progress: AppUpdateProgress) => void,
  ) => Promise<InstallAppUpdateResponse>;
  read: () => Promise<AppInfoResponse>;
  readProgress: () => Promise<AppUpdateProgressResponse>;
}

export interface CreateAppUpdateServiceOptions {
  appVersion: string;
  codexVersion: string;
  fetchChangelog?: (version: string) => Promise<string>;
  fetchLatestVersion?: () => Promise<string>;
  runNpmInstall?: (
    version: string,
    onProgress?: (progress: AppUpdateProgress) => void,
  ) => Promise<void>;
}

type ParsedVersion = Readonly<{
  core: readonly [string, string, string];
  prerelease: readonly string[];
}>;

type NpmInstallInvocation = Readonly<{
  args: readonly string[];
  command: string;
}>;

type RunNpmOptions = Readonly<{
  signal?: AbortSignal;
}>;

export interface SafeGlobalInstallOptions {
  currentPackageRoot?: string;
  onProgress?: (progress: AppUpdateProgress) => void;
  runNpm?: (args: readonly string[], options?: RunNpmOptions) => Promise<string>;
}

class UnpublishedPackageError extends Error {}

function parseSemanticVersion(version: string): ParsedVersion | undefined {
  const match = SEMANTIC_VERSION_PATTERN.exec(version);
  if (match === null) return undefined;
  return {
    core: [match[1] ?? "0", match[2] ?? "0", match[3] ?? "0"],
    prerelease: match[4]?.split(".") ?? [],
  };
}

function compareNumericIdentifiers(left: string, right: string): number {
  if (left.length !== right.length) return left.length - right.length;
  return left === right ? 0 : left < right ? -1 : 1;
}

function comparePrerelease(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) {
    return left.length === right.length ? 0 : left.length === 0 ? 1 : -1;
  }
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) continue;
    const leftIsNumeric = /^\d+$/u.test(leftPart);
    const rightIsNumeric = /^\d+$/u.test(rightPart);
    if (leftIsNumeric && rightIsNumeric) {
      return compareNumericIdentifiers(leftPart, rightPart);
    }
    if (leftIsNumeric) return -1;
    if (rightIsNumeric) return 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maxBytes) return value;
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, maxBytes)).trimEnd();
}

export function extractVersionReleaseNotes(changelog: string, version: string): string | undefined {
  const lines = changelog.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start < 0) return undefined;
  const nextVersionOffset = lines
    .slice(start + 1)
    .findIndex((line) => /^## \[[^\]]+\]/u.test(line));
  const end = nextVersionOffset < 0 ? lines.length : start + 1 + nextVersionOffset;
  const releaseNotes = lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
  return releaseNotes === "" ? undefined : truncateUtf8(releaseNotes, MAX_RELEASE_NOTES_BYTES);
}

export function resolveNpmInstallInvocation(
  version: string,
  platform: NodeJS.Platform = process.platform,
  execPath = process.execPath,
): NpmInstallInvocation {
  const packageSpec = `${PACKAGE_NAME}@${version}`;
  return resolveNpmCommandInvocation(["install", "--global", packageSpec], platform, execPath);
}

function resolveNpmCommandInvocation(
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  execPath = process.execPath,
): NpmInstallInvocation {
  if (platform !== "win32") {
    return { args, command: "npm" };
  }
  const npmCliPath = win32.join(
    win32.dirname(execPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  return {
    args: [npmCliPath, ...args],
    command: execPath,
  };
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const candidateVersion = parseSemanticVersion(candidate);
  const currentVersion = parseSemanticVersion(current);
  if (candidateVersion === undefined || currentVersion === undefined) return false;
  for (let index = 0; index < candidateVersion.core.length; index += 1) {
    const candidatePart = candidateVersion.core[index];
    const currentPart = currentVersion.core[index];
    if (candidatePart === undefined || currentPart === undefined) return false;
    const difference = compareNumericIdentifiers(candidatePart, currentPart);
    if (difference !== 0) return difference > 0;
  }
  return comparePrerelease(candidateVersion.prerelease, currentVersion.prerelease) > 0;
}

async function fetchLatestPackageVersion(): Promise<string> {
  const response = await fetch(
    `https://registry.npmjs.org/-/package/${encodeURIComponent(PACKAGE_NAME)}/dist-tags`,
    {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
    },
  );
  // npm 对尚未发布的 scoped package 可能返回 401 或 404。
  if (response.status === 401 || response.status === 404) {
    throw new UnpublishedPackageError("Package has not been published");
  }
  if (!response.ok) throw new Error(`Registry returned ${String(response.status)}`);
  const payload: unknown = await response.json();
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("latest" in payload) ||
    typeof payload.latest !== "string" ||
    parseSemanticVersion(payload.latest) === undefined
  ) {
    throw new Error("Registry returned an invalid latest version");
  }
  return payload.latest;
}

async function fetchTaggedChangelog(version: string): Promise<string> {
  const response = await fetch(`${CHANGELOG_URL_PREFIX}${version}/CHANGELOG.md`, {
    headers: { accept: "text/markdown" },
    signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GitHub returned ${String(response.status)}`);
  return response.text();
}

async function runNpmCommand(
  args: readonly string[],
  options: RunNpmOptions = {},
): Promise<string> {
  const invocation = resolveNpmCommandInvocation(args);
  return new Promise<string>((resolveCommand, reject) => {
    // Windows 直接交给 node.exe 执行 npm CLI，所有平台都不经过 shell。
    execFile(
      invocation.command,
      invocation.args,
      {
        shell: false,
        signal: options.signal,
        timeout: INSTALL_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error === null) resolveCommand(stdout);
        else reject(new Error("npm install failed", { cause: error }));
      },
    );
  });
}

async function findCurrentPackageRoot(): Promise<string> {
  let candidate = dirname(fileURLToPath(import.meta.url));
  const root = parse(candidate).root;
  while (candidate !== root) {
    try {
      const manifest: unknown = JSON.parse(await readFile(join(candidate, "package.json"), "utf8"));
      if (
        typeof manifest === "object" &&
        manifest !== null &&
        "name" in manifest &&
        manifest.name === PACKAGE_NAME
      ) {
        return candidate;
      }
    } catch {
      // 当前目录不是包根目录时继续向上查找。
    }
    candidate = dirname(candidate);
  }
  throw new Error("Unable to locate the installed Codexly package");
}

function readPackedArchivePath(output: string, temporaryDirectory: string): string {
  const payload = JSON.parse(output) as unknown;
  const entries = Array.isArray(payload) ? (payload as unknown[]) : [];
  const first = entries[0];
  if (
    typeof first !== "object" ||
    first === null ||
    !("filename" in first) ||
    typeof first.filename !== "string" ||
    basename(first.filename) !== first.filename
  ) {
    throw new Error("npm pack returned an invalid archive name");
  }
  return resolve(temporaryDirectory, first.filename);
}

async function packPackage(
  source: string,
  temporaryDirectory: string,
  runNpm: NonNullable<SafeGlobalInstallOptions["runNpm"]>,
  signal: AbortSignal,
): Promise<string> {
  const output = await runNpm(
    ["pack", "--ignore-scripts", "--json", "--pack-destination", temporaryDirectory, source],
    { signal },
  );
  return readPackedArchivePath(output, temporaryDirectory);
}

export async function installGlobalPackageSafely(
  version: string,
  options: SafeGlobalInstallOptions = {},
): Promise<void> {
  const runNpm = options.runNpm ?? runNpmCommand;
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "codexly-update-"));
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort(new Error("Codexly update interrupted"));
  };
  let backupArchive: string | undefined;
  let replacementStarted = false;
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);

  try {
    const currentPackageRoot = options.currentPackageRoot ?? (await findCurrentPackageRoot());
    // 先在临时目录保留旧版本并完整下载新版本，网络失败不会触碰现有安装。
    options.onProgress?.({ percent: 10, phase: "backing-up" });
    backupArchive = await packPackage(
      currentPackageRoot,
      temporaryDirectory,
      runNpm,
      controller.signal,
    );
    options.onProgress?.({ percent: 30, phase: "downloading" });
    const updateArchive = await packPackage(
      `${PACKAGE_NAME}@${version}`,
      temporaryDirectory,
      runNpm,
      controller.signal,
    );
    if (controller.signal.aborted) throw controller.signal.reason;
    options.onProgress?.({ percent: 80, phase: "installing" });
    replacementStarted = true;
    await runNpm(["install", "--global", updateArchive], { signal: controller.signal });
  } catch (error) {
    if (replacementStarted && backupArchive !== undefined) {
      try {
        // 回滚只读取本地归档，即使网络仍不可用也能恢复原命令。
        options.onProgress?.({ percent: 90, phase: "rolling-back" });
        await runNpm(["install", "--global", backupArchive]);
      } catch (rollbackError) {
        const updateMessage = error instanceof Error ? error.message : String(error);
        const rollbackMessage =
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        throw new Error(
          `Codexly update failed: ${updateMessage}; rollback failed: ${rollbackMessage}`,
          {
            cause: rollbackError,
          },
        );
      }
    }
    throw error;
  } finally {
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

async function installGlobalPackage(
  version: string,
  onProgress?: (progress: AppUpdateProgress) => void,
): Promise<void> {
  await installGlobalPackageSafely(version, onProgress === undefined ? {} : { onProgress });
}

export function createAppUpdateService(options: CreateAppUpdateServiceOptions): AppUpdateService {
  const fetchChangelog = options.fetchChangelog ?? fetchTaggedChangelog;
  const fetchLatestVersion = options.fetchLatestVersion ?? fetchLatestPackageVersion;
  const runNpmInstall = options.runNpmInstall ?? installGlobalPackage;
  let installedVersion: string | undefined;
  let updateProgress: AppUpdateProgress | null = null;

  const readLatest = async (): Promise<string> => {
    try {
      const latestVersion = await fetchLatestVersion();
      if (parseSemanticVersion(latestVersion) === undefined) throw new Error("Invalid version");
      return latestVersion;
    } catch (error) {
      // 首版本发布前没有 registry 基准，将本地首版本视为当前版本。
      if (error instanceof UnpublishedPackageError && options.appVersion === INITIAL_APP_VERSION) {
        return options.appVersion;
      }
      throw new AppUpdateError("UPDATE_CHECK_FAILED", "Failed to check for Codexly updates");
    }
  };

  return {
    async install(version, onProgress) {
      const publishProgress = (progress: AppUpdateProgress): void => {
        updateProgress = progress;
        onProgress?.(progress);
      };
      publishProgress({ percent: 5, phase: "checking" });
      const latestVersion = await readLatest();
      const requestedVersionIsAvailable =
        isNewerVersion(version, options.appVersion) && !isNewerVersion(version, latestVersion);
      if (!requestedVersionIsAvailable || !isNewerVersion(latestVersion, options.appVersion)) {
        updateProgress = null;
        throw new AppUpdateError("UPDATE_NOT_AVAILABLE", "The requested update is not available");
      }
      try {
        // 检查后出现新发布时直接安装最新版本，避免旧页面请求因版本推进而失败。
        await runNpmInstall(latestVersion, publishProgress);
      } catch {
        throw new AppUpdateError("UPDATE_INSTALL_FAILED", "Failed to install the Codexly update");
      }
      installedVersion = latestVersion;
      publishProgress({ percent: 100, phase: "completed" });
      return {
        appVersion: options.appVersion,
        codexVersion: options.codexVersion,
        latestVersion,
        releaseNotes: null,
        status: "restart-required",
        updateAvailable: false,
      };
    },
    readProgress() {
      return Promise.resolve({ progress: updateProgress });
    },
    async read() {
      let latestVersion: string;
      try {
        latestVersion = await readLatest();
      } catch {
        return {
          appVersion: options.appVersion,
          codexVersion: options.codexVersion,
          latestVersion: null,
          releaseNotes: null,
          status: "check-failed",
          updateAvailable: false,
        };
      }
      if (installedVersion === latestVersion) {
        return {
          appVersion: options.appVersion,
          codexVersion: options.codexVersion,
          latestVersion,
          releaseNotes: null,
          status: "restart-required",
          updateAvailable: false,
        };
      }
      const updateAvailable = isNewerVersion(latestVersion, options.appVersion);
      let releaseNotes: string | null = null;
      if (updateAvailable) {
        try {
          // 更新日志是辅助信息，读取失败不能掩盖已确认的可用更新。
          releaseNotes =
            extractVersionReleaseNotes(await fetchChangelog(latestVersion), latestVersion) ?? null;
        } catch {
          releaseNotes = null;
        }
      }
      return {
        appVersion: options.appVersion,
        codexVersion: options.codexVersion,
        latestVersion,
        releaseNotes,
        status: updateAvailable ? "available" : "current",
        updateAvailable,
      };
    },
  };
}
