import pLimit from "p-limit";

export type GitCommandExecutor = (
  repositoryRoot: string,
  arguments_: readonly string[],
) => Promise<string>;

export const MAX_GIT_COMMAND_CONCURRENCY = 4;
export const MAX_FILE_IO_CONCURRENCY = 8;

// Server 进程内共享队列；只包围实际资源操作，避免整次读取持有名额再等待子操作。
export const limitGitProcess = pLimit(MAX_GIT_COMMAND_CONCURRENCY);
export const limitGitFileIO = pLimit(MAX_FILE_IO_CONCURRENCY);
const limitedExecutors = new WeakMap<GitCommandExecutor, GitCommandExecutor>();

export function limitGitCommandExecutor(executor: GitCommandExecutor): GitCommandExecutor {
  const existing = limitedExecutors.get(executor);
  if (existing !== undefined) return existing;
  const limited: GitCommandExecutor = (root, args) => limitGitProcess(() => executor(root, args));
  // 默认适配器和状态读取共用此入口；标记包装结果以避免重复占用同一个队列而死锁。
  limitedExecutors.set(executor, limited);
  limitedExecutors.set(limited, limited);
  return limited;
}
