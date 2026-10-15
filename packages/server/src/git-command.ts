import { simpleGit, type SimpleGitOptions } from "simple-git";
import { limitGitCommandExecutor, type GitCommandExecutor } from "./git-concurrency.js";
export type { GitCommandExecutor } from "./git-concurrency.js";

const MAX_GIT_OUTPUT_BYTES = 10 * 1024 * 1024;
const GIT_COMMAND_TIMEOUT_MS = 10_000;
const UNSAFE_GIT_ENVIRONMENT_KEYS = new Set(["editor", "pager", "prefix", "ssh_askpass", "visual"]);

type GitCommandExecutorOptions = Readonly<{
  binary?: SimpleGitOptions["binary"];
  maxOutputBytes?: number;
  timeoutMs?: number;
}>;

export class GitCommandOutputLimitError extends Error {
  public constructor() {
    super("Git command output exceeded the limit");
    this.name = "GitCommandOutputLimitError";
  }
}

function chunkByteLength(chunk: unknown): number {
  if (Buffer.isBuffer(chunk)) {
    return chunk.byteLength;
  }
  return Buffer.byteLength(String(chunk));
}

export function createGitEnvironment(): NodeJS.ProcessEnv {
  // 保留 PATH、HOME、Locale 与 SSH Agent 等常规环境，拒绝能改写 Git 执行链的变量。
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => {
      // 覆盖全部 GIT_ 前缀，避免配置计数、仓库路径及未来新增变量绕过隔离。
      const normalizedKey = key.toLowerCase().trim();
      return !normalizedKey.startsWith("git_") && !UNSAFE_GIT_ENVIRONMENT_KEYS.has(normalizedKey);
    }),
  );
  environment["GIT_OPTIONAL_LOCKS"] = "0";
  return environment;
}

export function createGitCommandExecutor(
  options: GitCommandExecutorOptions = {},
): GitCommandExecutor {
  const maxOutputBytes = options.maxOutputBytes ?? MAX_GIT_OUTPUT_BYTES;
  const timeoutMs = options.timeoutMs ?? GIT_COMMAND_TIMEOUT_MS;

  return limitGitCommandExecutor(async (repositoryRoot, arguments_) => {
    const controller = new AbortController();
    const clientOptions: Partial<SimpleGitOptions> = {
      abort: controller.signal,
      // 仅放行内部设置的只读锁选项；Git 配置直接使用宿主用户的标准文件。
      allowEnvironment: ["GIT_OPTIONAL_LOCKS"],
      baseDir: repositoryRoot,
      maxConcurrentProcesses: 1,
      trimmed: false,
    };
    if (options.binary !== undefined) {
      clientOptions.binary = options.binary;
      // 仅由内部调用方注入的可执行文件路径允许空格和非 ASCII 字符；参数仍通过 spawn 数组传递。
      clientOptions.unsafe = { allowUnsafeCustomBinary: true };
    }

    const git = simpleGit(clientOptions);
    let failure: Error | undefined;
    let outputBytes = 0;
    const fail = (error: Error) => {
      if (failure !== undefined) {
        return;
      }
      failure = error;
      controller.abort(error);
    };

    git.env(createGitEnvironment());
    git.outputHandler((_command, stdout, stderr) => {
      // simple-git 不提供 maxBuffer；观察两个输出流并在越界时主动终止子进程。
      const countOutput = (chunk: unknown) => {
        outputBytes += chunkByteLength(chunk);
        if (outputBytes > maxOutputBytes) {
          fail(new GitCommandOutputLimitError());
        }
      };
      stdout.on("data", countOutput);
      stderr.on("data", countOutput);
    });

    const timeout = setTimeout(() => {
      fail(new Error("Git command timed out"));
    }, timeoutMs);
    timeout.unref();

    try {
      const output = await git.raw([...arguments_]);
      if (failure !== undefined) {
        throw failure;
      }
      return output;
    } catch (error) {
      throw failure ?? error;
    } finally {
      clearTimeout(timeout);
    }
  });
}

export const executeGit = createGitCommandExecutor();
