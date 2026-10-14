import { spawn } from "node:child_process";
import { createGitEnvironment } from "./git-command.js";
import { limitGitProcess } from "./git-concurrency.js";

const MAX_GIT_OUTPUT_BYTES = 10 * 1024 * 1024;
const GIT_COMMAND_TIMEOUT_MS = 55_000;

class GitCommandError extends Error {
  public constructor(
    public readonly exitCode: number | null,
    public readonly stderr: string,
  ) {
    super(stderr.length > 0 ? stderr : `Git command failed with exit code ${String(exitCode)}`);
    this.name = "GitCommandError";
  }
}

type GitCommandResult = Readonly<{ stderr: string; stdout: string }>;

export async function executeGit(
  repositoryRoot: string,
  arguments_: readonly string[],
  input = "",
  environment: Readonly<NodeJS.ProcessEnv> = {},
): Promise<GitCommandResult> {
  return limitGitProcess(() => runGitCommand(repositoryRoot, arguments_, input, environment));
}

async function runGitCommand(
  repositoryRoot: string,
  arguments_: readonly string[],
  input: string,
  environment: Readonly<NodeJS.ProcessEnv>,
): Promise<GitCommandResult> {
  return new Promise<GitCommandResult>((resolve, reject) => {
    const consumesInput = input !== "";
    const child = spawn("git", ["-C", repositoryRoot, ...arguments_], {
      env: { ...createGitEnvironment(), ...environment, GIT_TERMINAL_PROMPT: "0" },
      shell: false,
      // 无输入命令不创建 stdin pipe，避免短命令退出后写端异步触发 EPIPE。
      stdio: [consumesInput ? "pipe" : "ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let terminationError: Error | undefined;
    const finish = (error?: Error, result?: GitCommandResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (error !== undefined) {
        reject(error);
      } else if (result !== undefined) {
        resolve(result);
      }
    };
    const collect = (target: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_GIT_OUTPUT_BYTES) {
        terminate(new GitCommandError(null, "Git command output exceeded the limit"));
        return;
      }
      target.push(chunk);
    };
    const timeout = setTimeout(() => {
      terminate(new GitCommandError(null, "Git command timed out"));
    }, GIT_COMMAND_TIMEOUT_MS);
    // 终止信号发出后等待 close，确保子进程真正退出才归还全局并发名额。
    const terminate = (error: Error) => {
      terminationError ??= error;
      child.kill("SIGKILL");
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      collect(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      collect(stderr, chunk);
    });
    child.on("error", (error) => {
      finish(error);
    });
    child.stdin?.on("error", (error) => {
      terminate(error);
    });
    child.on("close", (exitCode) => {
      if (terminationError !== undefined) {
        finish(terminationError);
        return;
      }
      const result = {
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      };
      if (exitCode === 0) {
        finish(undefined, result);
      } else {
        finish(new GitCommandError(exitCode, result.stderr));
      }
    });
    if (consumesInput) {
      child.stdin?.end(input);
    }
  });
}
