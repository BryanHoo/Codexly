import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import type {
  ProjectGitCommit,
  ProjectGitHistoryPage,
  ProjectGitHistoryQuery,
} from "@codexly/protocol";

import { executeGit, type GitCommandExecutor } from "./git-command.js";
import { resolveGitPushTarget } from "./git-push-target.js";

const GIT_HISTORY_PAGE_SIZE = 20;
const GIT_HISTORY_FIELD_COUNT = 5;

export class GitHistoryError extends Error {
  public constructor(
    public readonly code: "INVALID_CURSOR" | "REPOSITORY_NOT_FOUND" | "UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "GitHistoryError";
  }
}

async function hasGitMetadata(repositoryRoot: string): Promise<boolean> {
  try {
    await lstat(join(repositoryRoot, ".git"));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function parseCursor(cursor: string | undefined): number {
  if (cursor === undefined) {
    return 0;
  }
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new GitHistoryError("INVALID_CURSOR", "Git history cursor is invalid");
  }
  return offset;
}

function parseGitHistory(output: string): ProjectGitCommit[] {
  const fields = output.split("\0");
  const commits: ProjectGitCommit[] = [];
  for (let offset = 0; offset + GIT_HISTORY_FIELD_COUNT - 1 < fields.length;) {
    const sha = (fields[offset] ?? "").trim();
    if (sha === "") {
      break;
    }
    const authorName = fields[offset + 1]?.trim() ?? "";
    const authorEmail = fields[offset + 2]?.trim() ?? "";
    const authoredAt = fields[offset + 3]?.trim() ?? "";
    const title = fields[offset + 4]?.trim() ?? "";
    if (!/^[a-f0-9]{40,64}$/u.test(sha) || Number.isNaN(Date.parse(authoredAt))) {
      throw new GitHistoryError("UNAVAILABLE", "Git history output is invalid");
    }
    commits.push({
      authoredAt,
      authorEmail: authorEmail || "unknown",
      authorName: authorName || "Unknown",
      sha,
      title: title || sha.slice(0, 12),
    });
    offset += GIT_HISTORY_FIELD_COUNT;
  }
  return commits;
}

function isEmptyRepositoryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /does not have any commits|unknown revision|bad revision ['"]?HEAD|needed a single revision/iu.test(
    message,
  );
}

async function readRepositoryPage(
  repositoryRoot: string,
  offset: number,
  gitCommandExecutor: GitCommandExecutor,
): Promise<
  Readonly<{ branch: string | null; commits: ProjectGitCommit[]; nextCursor: string | null }>
> {
  const branchPromise = gitCommandExecutor(repositoryRoot, ["branch", "--show-current"]).then(
    (output) => output.trim() || null,
  );
  try {
    const [branch, head] = await Promise.all([
      branchPromise,
      gitCommandExecutor(repositoryRoot, ["rev-parse", "--verify", "HEAD"]).then((value) =>
        value.trim(),
      ),
    ]);
    // 日志和远端比较固定到同一个 HEAD，防止读取期间新增提交挤掉本页的未推送标记。
    const output = await gitCommandExecutor(repositoryRoot, [
      "log",
      `--max-count=${String(GIT_HISTORY_PAGE_SIZE + 1)}`,
      `--skip=${String(offset)}`,
      "--format=%H%x00%an%x00%ae%x00%aI%x00%s%x00",
      head,
    ]);
    const parsedCommits = parseGitHistory(output);
    const commits = parsedCommits.slice(0, GIT_HISTORY_PAGE_SIZE);
    await markUnpushedCommits(repositoryRoot, branch, head, offset, commits, gitCommandExecutor);
    return {
      branch,
      commits,
      nextCursor:
        parsedCommits.length > GIT_HISTORY_PAGE_SIZE
          ? String(offset + GIT_HISTORY_PAGE_SIZE)
          : null,
    };
  } catch (error) {
    if (isEmptyRepositoryError(error)) {
      return { branch: await branchPromise, commits: [], nextCursor: null };
    }
    throw error;
  }
}

async function markUnpushedCommits(
  root: string,
  branch: string | null,
  head: string,
  offset: number,
  commits: ProjectGitCommit[],
  execute: GitCommandExecutor,
): Promise<void> {
  if (!branch || commits.length === 0) return;
  try {
    const names = (await execute(root, ["remote"])).trim().split("\n").filter(Boolean);
    const { remote, targetBranch } = await resolveGitPushTarget(root, branch, names, execute);
    if (!remote || !targetBranch) return;
    // 一次批量计算提交集合；上限覆盖当前页之前的全部条目，合并历史与翻页都不按序号猜测。
    // 仅比较本地已获取的引用，不额外联网；引用缺失时保留未知状态。
    const output = await execute(root, [
      "rev-list",
      `--max-count=${String(offset + GIT_HISTORY_PAGE_SIZE)}`,
      head,
      "--not",
      `refs/remotes/${remote}/${targetBranch}`,
      "--",
    ]);
    const unpushed = new Set(output.trim().split("\n").filter(Boolean));
    for (const [index, commit] of commits.entries()) {
      commits[index] = { ...commit, unpushed: unpushed.has(commit.sha) };
    }
  } catch {
    // 配置或引用暂不可读不应阻断历史，更不能展示未经确认的状态。
  }
}

export async function readProjectGitHistory(
  projectRoot: string,
  query: Omit<ProjectGitHistoryQuery, "rootPath"> = {},
  gitCommandExecutor: GitCommandExecutor = executeGit,
): Promise<ProjectGitHistoryPage> {
  if (!isAbsolute(projectRoot)) {
    throw new TypeError("Project root must be absolute");
  }

  // 历史只读取项目本身，非 Git 目录不能回落到父仓库或子仓库。
  const resolvedProjectRoot = await realpath(projectRoot);
  const offset = parseCursor(query.cursor);
  if (query.repository !== undefined || !(await hasGitMetadata(resolvedProjectRoot))) {
    throw new GitHistoryError("REPOSITORY_NOT_FOUND", "Git repository was not found");
  }
  const page = await readRepositoryPage(resolvedProjectRoot, offset, gitCommandExecutor);
  return { ...page, repositories: [], repository: null, repositoryMode: "root" };
}
