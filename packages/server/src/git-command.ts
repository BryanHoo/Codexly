import { simpleGit, type SimpleGitOptions } from "simple-git";

const MAX_GIT_OUTPUT_BYTES = 10 * 1024 * 1024;
const GIT_COMMAND_TIMEOUT_MS = 10_000;
const UNSAFE_GIT_ENVIRONMENT_KEYS = new Set([
  "editor",
  "git_askpass",
  "git_config",
  "git_config_count",
  "git_config_global",
  "git_config_system",
  "git_editor",
  "git_exec_path",
  "git_external_diff",
  "git_pager",
  "git_proxy_command",
  "git_sequence_editor",
  "git_ssh",
  "git_ssh_command",
  "git_template_dir",
  "pager",
  "prefix",
  "ssh_askpass",
]);

export type GitCommandExecutor = (
  repositoryRoot: string,
  arguments_: readonly string[],
) => Promise<string>;

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
    Object.entries(process.env).filter(
      ([key]) => !UNSAFE_GIT_ENVIRONMENT_KEYS.has(key.toLowerCase()),
    ),
  );
  environment["GIT_OPTIONAL_LOCKS"] = "0";
  return environment;
}

export function createGitCommandExecutor(
  options: GitCommandExecutorOptions = {},
): GitCommandExecutor {
  const maxOutputBytes = options.maxOutputBytes ?? MAX_GIT_OUTPUT_BYTES;
  const timeoutMs = options.timeoutMs ?? GIT_COMMAND_TIMEOUT_MS;

  return async (repositoryRoot, arguments_) => {
    const controller = new AbortController();
    const clientOptions: Partial<SimpleGitOptions> = {
      abort: controller.signal,
      baseDir: repositoryRoot,
      maxConcurrentProcesses: 1,
      trimmed: false,
    };
    if (options.binary !== undefined) {
      clientOptions.binary = options.binary;
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
  };
}

export const executeGit = createGitCommandExecutor();
