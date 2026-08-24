import { posix, win32 } from "node:path";

import type {
  ProjectOpenApp,
  ProjectOpenAppId,
  ProjectOpenAppKind,
  ProjectOpenPlatform,
} from "@code-agent/protocol";

export type ProjectOpenCommand = Readonly<{
  app: ProjectOpenApp;
  args: (target: ProjectOpenTarget) => readonly string[];
  file: string;
  observeEarlyExit: boolean;
  targetTypes: readonly ProjectOpenTarget["type"][];
}>;

export type ProjectOpenTarget = Readonly<{
  absolutePath: string;
  directoryPath: string;
  projectRoot: string;
  type: "directory" | "file";
}>;

export type ProjectOpenCommandMap = Map<ProjectOpenAppId, ProjectOpenCommand>;

type ProjectOpenCommandOptions = Readonly<{
  observeEarlyExit?: boolean;
  targetTypes?: readonly ProjectOpenTarget["type"][];
}>;

export const DEFAULT_LAUNCH_CONFIRMATION_MS = 500;
function readEnvironmentValue(environment: NodeJS.ProcessEnv, names: readonly string[]) {
  for (const name of names) {
    const direct = environment[name];
    if (direct !== undefined && direct.length > 0) {
      return direct;
    }
    const matched = Object.entries(environment).find(
      ([key, value]) => key.toLowerCase() === name.toLowerCase() && value !== undefined,
    )?.[1];
    if (matched !== undefined && matched.length > 0) {
      return matched;
    }
  }
  return undefined;
}

async function firstExisting(
  candidates: readonly (string | undefined)[],
  pathExists: (path: string) => Promise<boolean>,
): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (candidate !== undefined && (await pathExists(candidate))) {
      return candidate;
    }
  }
  return undefined;
}

async function findPathExecutable(
  command: string,
  platform: ProjectOpenPlatform,
  environment: NodeJS.ProcessEnv,
  pathExists: (path: string) => Promise<boolean>,
): Promise<string | undefined> {
  const pathValue = readEnvironmentValue(environment, ["PATH"]);
  if (pathValue === undefined) {
    return undefined;
  }
  const pathApi = platform === "win32" ? win32 : posix;
  const delimiter = platform === "win32" ? ";" : ":";
  return firstExisting(
    pathValue
      .split(delimiter)
      .filter(Boolean)
      .map((directory) => pathApi.join(directory, command)),
    pathExists,
  );
}

function addCommand(
  commands: ProjectOpenCommandMap,
  app: Readonly<{ id: ProjectOpenAppId; kind: ProjectOpenAppKind; name: string }>,
  file: string | undefined,
  args: (target: ProjectOpenTarget) => readonly string[],
  options: ProjectOpenCommandOptions = {},
): void {
  if (file !== undefined) {
    commands.set(app.id, {
      app,
      args,
      file,
      observeEarlyExit: options.observeEarlyExit ?? true,
      targetTypes: options.targetTypes ?? ["directory", "file"],
    });
  }
}

function macAppCandidates(home: string | undefined, appName: string): readonly string[] {
  return [
    posix.join("/Applications", `${appName}.app`),
    ...(home === undefined ? [] : [posix.join(home, "Applications", `${appName}.app`)]),
  ];
}

export async function resolveMacCommands(
  environment: NodeJS.ProcessEnv,
  pathExists: (path: string) => Promise<boolean>,
): Promise<ProjectOpenCommandMap> {
  const commands: ProjectOpenCommandMap = new Map();
  const open = await firstExisting(["/usr/bin/open"], pathExists);
  if (open === undefined) {
    return commands;
  }
  const home = readEnvironmentValue(environment, ["HOME"]);
  const resolveApp = (name: string) => firstExisting(macAppCandidates(home, name), pathExists);
  const addMacApp = async (id: ProjectOpenAppId, name: string, kind: ProjectOpenAppKind) => {
    const appPath = await resolveApp(name);
    addCommand(commands, { id, kind, name }, appPath === undefined ? undefined : open, (target) => [
      "-a",
      name,
      kind === "terminal" ? target.directoryPath : target.absolutePath,
    ]);
  };

  // 顺序与官方 App 的打开菜单一致，开发工具优先，系统位置与终端随后。
  await addMacApp("zed", "Zed", "editor");
  await addMacApp("windsurf", "Windsurf", "editor");
  await addMacApp("visual-studio-code", "Visual Studio Code", "editor");
  addCommand(
    commands,
    { id: "system-default", kind: "system-default", name: "系统默认应用" },
    open,
    (target) => [target.absolutePath],
    { targetTypes: ["file"] },
  );
  addCommand(commands, { id: "finder", kind: "file-manager", name: "Finder" }, open, (target) =>
    target.type === "file" ? ["-R", target.absolutePath] : [target.absolutePath],
  );
  const terminalPath = await firstExisting(
    ["/System/Applications/Utilities/Terminal.app", "/Applications/Utilities/Terminal.app"],
    pathExists,
  );
  addCommand(
    commands,
    { id: "terminal", kind: "terminal", name: "Terminal" },
    terminalPath === undefined ? undefined : open,
    (target) => ["-a", "Terminal", target.directoryPath],
  );
  await addMacApp("ghostty", "Ghostty", "terminal");
  await addMacApp("xcode", "Xcode", "editor");
  await addMacApp("android-studio", "Android Studio", "editor");
  return commands;
}

export async function resolveLinuxCommands(
  environment: NodeJS.ProcessEnv,
  pathExists: (path: string) => Promise<boolean>,
): Promise<ProjectOpenCommandMap> {
  const commands: ProjectOpenCommandMap = new Map();
  const find = (command: string) => findPathExecutable(command, "linux", environment, pathExists);

  addCommand(commands, { id: "zed", kind: "editor", name: "Zed" }, await find("zed"), (target) => [
    target.absolutePath,
  ]);
  addCommand(
    commands,
    { id: "windsurf", kind: "editor", name: "Windsurf" },
    await find("windsurf"),
    (target) => [target.absolutePath],
  );
  addCommand(
    commands,
    { id: "visual-studio-code", kind: "editor", name: "Visual Studio Code" },
    await find("code"),
    (target) => [target.absolutePath],
  );
  const desktopOpen = await find("xdg-open");
  addCommand(
    commands,
    { id: "system-default", kind: "system-default", name: "系统默认应用" },
    desktopOpen,
    (target) => [target.absolutePath],
    { targetTypes: ["file"] },
  );
  addCommand(
    commands,
    { id: "file-manager", kind: "file-manager", name: "文件管理器" },
    desktopOpen,
    (target) => [target.directoryPath],
  );
  addCommand(
    commands,
    { id: "ghostty", kind: "terminal", name: "Ghostty" },
    await find("ghostty"),
    (target) => [`--working-directory=${target.directoryPath}`],
  );
  addCommand(
    commands,
    { id: "gnome-terminal", kind: "terminal", name: "GNOME Terminal" },
    await find("gnome-terminal"),
    (target) => [`--working-directory=${target.directoryPath}`],
  );
  addCommand(
    commands,
    { id: "konsole", kind: "terminal", name: "Konsole" },
    await find("konsole"),
    (target) => ["--workdir", target.directoryPath],
  );
  addCommand(
    commands,
    { id: "xfce-terminal", kind: "terminal", name: "Xfce Terminal" },
    await find("xfce4-terminal"),
    (target) => ["--working-directory", target.directoryPath],
  );
  const androidStudio = await firstExisting(
    ["/opt/android-studio/bin/studio.sh", await find("android-studio"), await find("studio.sh")],
    pathExists,
  );
  addCommand(
    commands,
    { id: "android-studio", kind: "editor", name: "Android Studio" },
    androidStudio,
    (target) => [target.absolutePath],
  );
  return commands;
}

export async function resolveWindowsCommands(
  environment: NodeJS.ProcessEnv,
  pathExists: (path: string) => Promise<boolean>,
): Promise<ProjectOpenCommandMap> {
  const commands: ProjectOpenCommandMap = new Map();
  const systemRoot = readEnvironmentValue(environment, ["SystemRoot", "WINDIR"]);
  const localAppData = readEnvironmentValue(environment, ["LOCALAPPDATA"]);
  const programFiles = readEnvironmentValue(environment, ["ProgramFiles"]);
  const programFilesX86 = readEnvironmentValue(environment, ["ProgramFiles(x86)"]);
  const find = (command: string) => findPathExecutable(command, "win32", environment, pathExists);

  const zed = await firstExisting(
    [
      localAppData === undefined
        ? undefined
        : win32.join(localAppData, "Programs", "Zed", "Zed.exe"),
      await find("Zed.exe"),
    ],
    pathExists,
  );
  addCommand(commands, { id: "zed", kind: "editor", name: "Zed" }, zed, (target) => [
    target.absolutePath,
  ]);
  const windsurf = await firstExisting(
    [
      localAppData === undefined
        ? undefined
        : win32.join(localAppData, "Programs", "Windsurf", "Windsurf.exe"),
      await find("Windsurf.exe"),
    ],
    pathExists,
  );
  addCommand(commands, { id: "windsurf", kind: "editor", name: "Windsurf" }, windsurf, (target) => [
    target.absolutePath,
  ]);
  const vscode = await firstExisting(
    [
      localAppData === undefined
        ? undefined
        : win32.join(localAppData, "Programs", "Microsoft VS Code", "Code.exe"),
      programFiles === undefined
        ? undefined
        : win32.join(programFiles, "Microsoft VS Code", "Code.exe"),
      programFilesX86 === undefined
        ? undefined
        : win32.join(programFilesX86, "Microsoft VS Code", "Code.exe"),
      await find("Code.exe"),
    ],
    pathExists,
  );
  addCommand(
    commands,
    { id: "visual-studio-code", kind: "editor", name: "Visual Studio Code" },
    vscode,
    (target) => [target.absolutePath],
  );
  const explorer = await firstExisting(
    [
      systemRoot === undefined ? undefined : win32.join(systemRoot, "explorer.exe"),
      await find("explorer.exe"),
    ],
    pathExists,
  );
  addCommand(
    commands,
    { id: "system-default", kind: "system-default", name: "系统默认应用" },
    explorer,
    (target) => [target.absolutePath],
    { observeEarlyExit: false, targetTypes: ["file"] },
  );
  addCommand(
    commands,
    { id: "explorer", kind: "file-manager", name: "文件资源管理器" },
    explorer,
    (target) =>
      target.type === "file" ? ["/select,", target.absolutePath] : [target.absolutePath],
    { observeEarlyExit: false },
  );
  const windowsTerminal = await firstExisting(
    [
      localAppData === undefined
        ? undefined
        : win32.join(localAppData, "Microsoft", "WindowsApps", "wt.exe"),
      await find("wt.exe"),
    ],
    pathExists,
  );
  addCommand(
    commands,
    { id: "windows-terminal", kind: "terminal", name: "Windows Terminal" },
    windowsTerminal,
    (target) => ["-w", "new", "-d", target.directoryPath],
  );
  const commandPrompt = await firstExisting(
    [
      readEnvironmentValue(environment, ["COMSPEC"]),
      systemRoot === undefined ? undefined : win32.join(systemRoot, "System32", "cmd.exe"),
    ],
    pathExists,
  );
  addCommand(
    commands,
    { id: "command-prompt", kind: "terminal", name: "命令提示符" },
    commandPrompt,
    () => ["/d", "/k"],
  );
  const androidStudio = await firstExisting(
    [
      programFiles === undefined
        ? undefined
        : win32.join(programFiles, "Android", "Android Studio", "bin", "studio64.exe"),
      programFilesX86 === undefined
        ? undefined
        : win32.join(programFilesX86, "Android", "Android Studio", "bin", "studio64.exe"),
      await find("studio64.exe"),
    ],
    pathExists,
  );
  addCommand(
    commands,
    { id: "android-studio", kind: "editor", name: "Android Studio" },
    androidStudio,
    (target) => [target.absolutePath],
  );
  return commands;
}
