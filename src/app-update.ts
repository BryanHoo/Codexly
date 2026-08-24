import { execFile } from "node:child_process";
import { win32 } from "node:path";

import type { AppInfoResponse, InstallAppUpdateResponse } from "@codexly/protocol";

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
  install: (version: string) => Promise<InstallAppUpdateResponse>;
  read: () => Promise<AppInfoResponse>;
}

export interface CreateAppUpdateServiceOptions {
  appVersion: string;
  codexVersion: string;
  fetchChangelog?: (version: string) => Promise<string>;
  fetchLatestVersion?: () => Promise<string>;
  runNpmInstall?: (version: string) => Promise<void>;
}

type ParsedVersion = Readonly<{
  core: readonly [string, string, string];
  prerelease: readonly string[];
}>;

type NpmInstallInvocation = Readonly<{
  args: readonly string[];
  command: string;
}>;

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
  if (platform !== "win32") {
    return { args: ["install", "--global", packageSpec], command: "npm" };
  }
  const npmCliPath = win32.join(
    win32.dirname(execPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  return {
    args: [npmCliPath, "install", "--global", packageSpec],
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

async function installGlobalPackage(version: string): Promise<void> {
  const invocation = resolveNpmInstallInvocation(version);
  await new Promise<void>((resolve, reject) => {
    // Windows 直接交给 node.exe 执行 npm CLI，所有平台都不经过 shell。
    execFile(
      invocation.command,
      invocation.args,
      { shell: false, timeout: INSTALL_TIMEOUT_MS, windowsHide: true },
      (error) => {
        if (error === null) resolve();
        else reject(new Error("npm install failed", { cause: error }));
      },
    );
  });
}

export function createAppUpdateService(options: CreateAppUpdateServiceOptions): AppUpdateService {
  const fetchChangelog = options.fetchChangelog ?? fetchTaggedChangelog;
  const fetchLatestVersion = options.fetchLatestVersion ?? fetchLatestPackageVersion;
  const runNpmInstall = options.runNpmInstall ?? installGlobalPackage;
  let installedVersion: string | undefined;

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
    async install(version) {
      const latestVersion = await readLatest();
      if (version !== latestVersion || !isNewerVersion(latestVersion, options.appVersion)) {
        throw new AppUpdateError("UPDATE_NOT_AVAILABLE", "The requested update is not available");
      }
      try {
        await runNpmInstall(latestVersion);
      } catch {
        throw new AppUpdateError("UPDATE_INSTALL_FAILED", "Failed to install the Codexly update");
      }
      installedVersion = latestVersion;
      return {
        appVersion: options.appVersion,
        codexVersion: options.codexVersion,
        latestVersion,
        releaseNotes: null,
        status: "restart-required",
        updateAvailable: false,
      };
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
