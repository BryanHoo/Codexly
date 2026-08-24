import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve as resolvePath, sep } from "node:path";

import type {
  ProjectOpenAppId,
  ProjectOpenCapabilitiesResponse,
  ProjectOpenPlatform,
} from "@codexly/protocol";

type SpawnDetachedOptions = Readonly<{
  cwd: string;
  observeEarlyExit: boolean;
  shell: false;
  windowsHide: boolean;
}>;

type SpawnDetached = (
  file: string,
  args: readonly string[],
  options: SpawnDetachedOptions,
) => Promise<void>;

import {
  DEFAULT_LAUNCH_CONFIRMATION_MS,
  resolveLinuxCommands,
  resolveMacCommands,
  resolveWindowsCommands,
  type ProjectOpenTarget,
} from "./project-open-commands.js";

export interface ProjectOpenService {
  getCapabilities: () => Promise<ProjectOpenCapabilitiesResponse>;
  open: (
    projectRoot: string,
    appId: ProjectOpenAppId,
    projectRelativePath?: string,
  ) => Promise<void>;
}

export interface CreateProjectOpenServiceOptions {
  environment?: NodeJS.ProcessEnv;
  launchConfirmationMs?: number;
  pathExists?: (path: string) => Promise<boolean>;
  platform?: ProjectOpenPlatform;
  spawnDetached?: SpawnDetached;
}

export class ProjectOpenAppUnavailableError extends Error {
  public constructor(appId: ProjectOpenAppId) {
    super(`Project open app is unavailable: ${appId}`);
    this.name = "ProjectOpenAppUnavailableError";
  }
}

export class ProjectOpenTargetInvalidError extends Error {
  public constructor() {
    super("Project open target is invalid");
    this.name = "ProjectOpenTargetInvalidError";
  }
}

function isOutsideProject(relativePath: string): boolean {
  return relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
}

async function resolveProjectOpenTarget(
  projectRoot: string,
  projectPath: string | undefined,
): Promise<ProjectOpenTarget> {
  if (projectPath === undefined) {
    return {
      absolutePath: projectRoot,
      directoryPath: projectRoot,
      projectRoot,
      type: "directory",
    };
  }

  try {
    if (!isAbsolute(projectRoot)) {
      throw new ProjectOpenTargetInvalidError();
    }
    const resolvedProjectRoot = await realpath(projectRoot);
    if (isAbsolute(projectPath)) {
      // AI 输出的显式绝对路径允许打开 Project 外的本机可读文件。
      const resolvedTargetPath = await realpath(projectPath);
      const targetStats = await stat(resolvedTargetPath);
      if (!targetStats.isDirectory() && !targetStats.isFile()) {
        throw new ProjectOpenTargetInvalidError();
      }
      await access(resolvedTargetPath, constants.R_OK);
      const type = targetStats.isDirectory() ? "directory" : "file";
      return {
        absolutePath: resolvedTargetPath,
        directoryPath: type === "directory" ? resolvedTargetPath : dirname(resolvedTargetPath),
        projectRoot: resolvedProjectRoot,
        type,
      };
    }

    const relativeTargetPath = projectPath;
    if (
      isOutsideProject(relativeTargetPath) ||
      relativeTargetPath.endsWith("/") ||
      relativeTargetPath.includes("\\") ||
      relativeTargetPath.includes("//") ||
      /^[A-Za-z]:/u.test(relativeTargetPath)
    ) {
      throw new ProjectOpenTargetInvalidError();
    }
    const segments = relativeTargetPath.split("/");
    if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
      throw new ProjectOpenTargetInvalidError();
    }

    let candidatePath = resolvedProjectRoot;
    let targetStats;
    // 逐段拒绝符号链接，避免即使最终 realpath 位于 Project 内也打开树中不可见的别名目标。
    for (const segment of segments) {
      candidatePath = resolvePath(candidatePath, segment);
      targetStats = await lstat(candidatePath);
      if (targetStats.isSymbolicLink()) {
        throw new ProjectOpenTargetInvalidError();
      }
    }
    const resolvedTargetPath = await realpath(candidatePath);
    if (isOutsideProject(relative(resolvedProjectRoot, resolvedTargetPath))) {
      throw new ProjectOpenTargetInvalidError();
    }
    if (targetStats === undefined || (!targetStats.isDirectory() && !targetStats.isFile())) {
      throw new ProjectOpenTargetInvalidError();
    }
    const type = targetStats.isDirectory() ? "directory" : "file";
    return {
      absolutePath: resolvedTargetPath,
      directoryPath: type === "directory" ? resolvedTargetPath : dirname(resolvedTargetPath),
      projectRoot: resolvedProjectRoot,
      type,
    };
  } catch (error) {
    if (error instanceof ProjectOpenTargetInvalidError) {
      throw error;
    }
    throw new ProjectOpenTargetInvalidError();
  }
}

async function defaultPathExists(path: string): Promise<boolean> {
  try {
    // 能力菜单只暴露当前进程实际可执行的宿主程序或可访问的应用包。
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function defaultSpawnDetached(
  file: string,
  args: readonly string[],
  options: SpawnDetachedOptions,
  launchConfirmationMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const { observeEarlyExit, ...spawnOptions } = options;
    const child = spawn(file, [...args], {
      ...spawnOptions,
      detached: true,
      stdio: "ignore",
    });
    let settled = false;
    let confirmationTimer: ReturnType<typeof setTimeout> | undefined;
    const settle = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (confirmationTimer !== undefined) {
        clearTimeout(confirmationTimer);
      }
      action();
    };
    child.once("error", (error) => {
      settle(() => {
        reject(error);
      });
    });
    child.once("spawn", () => {
      if (!observeEarlyExit) {
        // Windows 系统代理只负责转交请求，成功转交后的退出码不代表目标窗口启动失败。
        settle(() => {
          child.unref();
          resolve();
        });
        return;
      }
      // GUI 进程可能长驻；短暂观察可捕获启动失败，同时避免等待应用整个生命周期。
      confirmationTimer = setTimeout(() => {
        settle(() => {
          child.unref();
          resolve();
        });
      }, launchConfirmationMs);
    });
    child.once("exit", (exitCode, signal) => {
      if (exitCode === 0) {
        settle(resolve);
        return;
      }
      const reason = signal ? `signal ${signal}` : `code ${String(exitCode)}`;
      settle(() => {
        reject(new Error(`${file} exited with ${reason}`));
      });
    });
  });
}

export function createProjectOpenService(
  options: CreateProjectOpenServiceOptions = {},
): ProjectOpenService {
  const platform = options.platform ?? (process.platform as ProjectOpenPlatform);
  const environment = options.environment ?? process.env;
  const pathExists = options.pathExists ?? defaultPathExists;
  // 生产保持短确认窗；测试和慢速宿主可延长观察时间，避免把迟到的失败退出判为成功。
  const launchConfirmationMs = options.launchConfirmationMs ?? DEFAULT_LAUNCH_CONFIRMATION_MS;
  const spawnDetached =
    options.spawnDetached ??
    ((file, args, spawnOptions) =>
      defaultSpawnDetached(file, args, spawnOptions, launchConfirmationMs));

  const resolveCommands = () => {
    switch (platform) {
      case "darwin":
        return resolveMacCommands(environment, pathExists);
      case "linux":
        return resolveLinuxCommands(environment, pathExists);
      case "win32":
        return resolveWindowsCommands(environment, pathExists);
    }
  };

  return {
    async getCapabilities() {
      const commands = await resolveCommands();
      return { apps: [...commands.values()].map((command) => command.app), platform };
    },
    async open(projectRoot, appId, projectRelativePath) {
      const command = (await resolveCommands()).get(appId);
      if (command === undefined) {
        throw new ProjectOpenAppUnavailableError(appId);
      }
      const target = await resolveProjectOpenTarget(projectRoot, projectRelativePath);
      // 系统默认关联只对文件有明确语义，目录仍交给文件管理器等专用能力。
      if (!command.targetTypes.includes(target.type)) {
        throw new ProjectOpenTargetInvalidError();
      }
      await spawnDetached(command.file, command.args(target), {
        cwd: command.app.kind === "terminal" ? target.directoryPath : target.projectRoot,
        observeEarlyExit: command.observeEarlyExit,
        shell: false,
        windowsHide: false,
      });
    },
  };
}
