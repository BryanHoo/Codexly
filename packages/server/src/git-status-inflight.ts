import { realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";

import type { ProjectGitStatus } from "@codexly/protocol";

import type { GitCommandExecutor } from "./git-command.js";
import { limitGitFileIO } from "./git-concurrency.js";

const inflightByExecutor = new WeakMap<
  GitCommandExecutor,
  Map<string, Promise<ProjectGitStatus>>
>();

export async function readInflightGitStatus(
  root: string,
  executor: GitCommandExecutor,
  includeDiff: boolean,
  read: (resolvedRoot: string) => Promise<ProjectGitStatus>,
): Promise<ProjectGitStatus> {
  if (!isAbsolute(root)) throw new TypeError("Project root must be absolute");
  // 每次解析真实路径，既合并路径别名，也避免符号链接被替换后复用旧仓库的请求。
  const resolvedRoot = await limitGitFileIO(() => realpath(root));
  let inflight = inflightByExecutor.get(executor);
  if (inflight === undefined) {
    inflight = new Map();
    inflightByExecutor.set(executor, inflight);
  }
  const key = JSON.stringify([resolvedRoot, includeDiff]);
  const existing = inflight.get(key);
  if (existing !== undefined) return existing;
  const pending = read(resolvedRoot);
  inflight.set(key, pending);
  try {
    return await pending;
  } finally {
    // 只合并在途结果，不缓存成功或失败；后续刷新及提交校验必须重新读取。
    inflight.delete(key);
  }
}
