import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";

import { createAppUpdateService } from "./app-update.js";

export const STARTUP_UPDATE_APPLIED_ENV = "CODEXLY_STARTUP_UPDATE_APPLIED";

export type StartupAppUpdateCheck = Readonly<{
  latestVersion: string | null;
  status: "available" | "check-failed" | "current";
}>;

export function createStartupAppUpdateOperations(appVersion: string): {
  check: () => Promise<StartupAppUpdateCheck>;
  install: (version: string) => Promise<void>;
} {
  const service = createAppUpdateService({
    appVersion,
    // 启动前 Codex 尚未运行，此服务只消费版本检查和安装结果。
    codexVersion: "not-started",
  });
  return {
    check: async () => {
      const info = await service.read();
      return {
        latestVersion: info.latestVersion,
        status:
          info.status === "available"
            ? "available"
            : info.status === "check-failed"
              ? "check-failed"
              : "current",
      };
    },
    install: async (version) => {
      await service.install(version);
    },
  };
}

export async function confirmTerminalAppUpdate(
  currentVersion: string,
  latestVersion: string,
): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await terminal.question(
      `发现 Codexly 新版本 ${latestVersion}（当前 ${currentVersion}），是否更新后启动？[y/N] `,
    );
    const normalizedAnswer = answer.trim().toLocaleLowerCase();
    return normalizedAnswer === "y" || normalizedAnswer === "yes";
  } finally {
    terminal.close();
  }
}

export async function restartCliAfterUpdate(args: readonly string[]): Promise<number> {
  const cliEntry = process.argv[1];
  if (cliEntry === undefined) throw new Error("无法确定 Codexly CLI 入口");

  return new Promise<number>((resolve, reject) => {
    // 重新载入已安装文件；内部标记避免本地开发入口再次询问同一更新。
    const child = spawn(process.execPath, [cliEntry, ...args], {
      env: { ...process.env, [STARTUP_UPDATE_APPLIED_ENV]: "1" },
      shell: false,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal !== null) {
        reject(new Error(`更新后的 Codexly 启动进程被信号 ${signal} 终止`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}
