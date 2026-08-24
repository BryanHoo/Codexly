import { spawn } from "node:child_process";

type BrowserCommand = Readonly<{ args: readonly string[]; executable: string }>;
type LaunchBrowserCommand = (command: BrowserCommand) => Promise<void>;

const LAUNCH_CONFIRMATION_MS = 500;

export interface OpenSystemBrowserOptions {
  launch?: LaunchBrowserCommand;
  platform?: NodeJS.Platform;
}

function browserCommands(url: string, platform: NodeJS.Platform): readonly BrowserCommand[] {
  if (platform === "darwin") {
    return [{ args: [url], executable: "open" }];
  }
  if (platform === "win32") {
    return [{ args: ["/c", "start", "", url], executable: "cmd.exe" }];
  }
  return [
    { args: [url], executable: "xdg-open" },
    { args: ["open", url], executable: "gio" },
    { args: [url], executable: "sensible-browser" },
  ];
}

function launchBrowserCommand(command: BrowserCommand): Promise<void> {
  return new Promise((resolveOpen, reject) => {
    const child = spawn(command.executable, [...command.args], {
      detached: true,
      shell: false,
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
      // 快速失败的桌面启动器会立即退出；持续运行超过确认窗口即可安全脱离父进程。
      confirmationTimer = setTimeout(() => {
        settle(() => {
          child.unref();
          resolveOpen();
        });
      }, LAUNCH_CONFIRMATION_MS);
    });
    child.once("exit", (exitCode, signal) => {
      if (exitCode === 0) {
        settle(resolveOpen);
        return;
      }
      const reason = signal ? `signal ${signal}` : `code ${String(exitCode)}`;
      settle(() => {
        reject(
          Object.assign(new Error(`${command.executable} exited with ${reason}`), {
            code: "LAUNCHER_EXIT",
          }),
        );
      });
    });
  });
}

export async function openSystemBrowser(
  url: string,
  options: OpenSystemBrowserOptions = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  const commands = browserCommands(url, platform);
  const launch = options.launch ?? launchBrowserCommand;
  let lastLauncherError: unknown;

  for (const command of commands) {
    try {
      await launch(command);
      return;
    } catch (error) {
      if (platform !== "linux" && (error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      lastLauncherError = error;
    }
  }

  throw new Error("No supported browser launcher is installed", { cause: lastLauncherError });
}
