import { spawn } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, join, win32 } from "node:path";

import type { RunNpmOptions } from "./npm-registry.js";

const INSTALL_TIMEOUT_MS = 2 * 60_000;

export type NpmCommandInvocation = Readonly<{
  args: readonly string[];
  command: string;
}>;

export function resolveNpmCommandInvocation(
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  execPath = process.execPath,
  elevated = false,
): NpmCommandInvocation {
  // 优先用当前 Node 自带的 npm，避免 PATH 指向另一套 Node 安装。
  const bundledNpmCli = join(
    dirname(execPath),
    "..",
    "lib",
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  const invocation =
    platform === "win32"
      ? {
          args: [
            win32.join(win32.dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js"),
            ...args,
          ],
          command: execPath,
        }
      : existsSync(bundledNpmCli)
        ? { args: [bundledNpmCli, ...args], command: execPath }
        : { args, command: "npm" };

  if (!elevated) return invocation;
  if (platform === "win32") throw new Error("Elevated npm updates are not supported on Windows");
  return { args: ["--", invocation.command, ...invocation.args], command: "sudo" };
}

export async function requiresElevatedNpmInstall(
  currentPackageRoot: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  if (platform !== "linux" || process.getuid?.() === 0) return false;
  try {
    // npm 替换包时会在 scoped package 的父目录中执行 rename。
    await access(dirname(currentPackageRoot), constants.W_OK);
    return false;
  } catch {
    return true;
  }
}

export async function runNpmCommand(
  args: readonly string[],
  options: RunNpmOptions = {},
): Promise<string> {
  const invocation = resolveNpmCommandInvocation(
    args,
    process.platform,
    process.execPath,
    options.elevated,
  );
  const elevated = options.elevated === true;

  return new Promise<string>((resolveCommand, rejectCommand) => {
    // 提权时继承终端输入和错误输出，让 sudo 安全地读取密码并展示提示。
    const child = spawn(invocation.command, invocation.args, {
      shell: false,
      signal: options.signal,
      stdio: elevated ? ["inherit", "pipe", "inherit"] : ["ignore", "pipe", "pipe"],
      timeout: INSTALL_TIMEOUT_MS,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", rejectCommand);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolveCommand(stdout);
        return;
      }
      const detail = stderr.trim();
      rejectCommand(
        new Error(
          `npm command failed${signal === null ? ` with exit code ${String(code)}` : ` with signal ${signal}`}${detail === "" ? "" : `: ${detail}`}`,
        ),
      );
    });
  });
}
