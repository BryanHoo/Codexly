import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import type {
  CreateProjectWorktreeRequest,
  ProjectGitStatus,
  ProjectGitWorktree,
  ProjectGitWorktreePage,
} from "@codexly/protocol";

import { executeGit, type GitCommandExecutor } from "./git-command.js";
import { originalErrorMessage } from "./error-message.js";
import { invalidateGitBranchCache, readGitWorkingTreeStatus } from "./git-working-tree.js";

const MAX_PROJECT_WORKTREES = 256;

export type GitWorktreeErrorCode =
  | "ALREADY_ACTIVE"
  | "CREATE_FAILED"
  | "INVALID_BRANCH_NAME"
  | "REPOSITORY_READ_ONLY"
  | "SNAPSHOT_MISMATCH"
  | "WORKTREE_NOT_FOUND";

export class GitWorktreeError extends Error {
  public readonly code: GitWorktreeErrorCode;

  public constructor(code: GitWorktreeErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "GitWorktreeError";
  }
}

type GitStatusReader = (
  projectRoot: string,
  gitCommandExecutor?: GitCommandExecutor,
) => Promise<ProjectGitStatus>;

type GitWorktreeReader = (
  projectRoot: string,
  gitCommandExecutor?: GitCommandExecutor,
) => Promise<ProjectGitWorktreePage>;

function parseWorktreeRecord(fields: readonly string[], currentPath: string) {
  const pathField = fields.find((field) => field.startsWith("worktree "));
  if (pathField === undefined) return undefined;
  const path = pathField.slice("worktree ".length);
  if (!isAbsolute(path)) {
    throw new Error("Git worktree path must be absolute");
  }
  const branchField = fields.find((field) => field.startsWith("branch refs/heads/"));
  return {
    branch: branchField?.slice("branch refs/heads/".length) ?? null,
    current: resolve(path) === resolve(currentPath),
    path,
  } satisfies ProjectGitWorktree;
}

export function parseGitWorktreeList(output: string, currentPath: string): ProjectGitWorktree[] {
  const worktrees: ProjectGitWorktree[] = [];
  let record: string[] = [];
  const flushRecord = () => {
    const worktree = parseWorktreeRecord(record, currentPath);
    if (worktree !== undefined) worktrees.push(worktree);
    record = [];
  };

  // `-z` 让路径中的换行保持原样；空字段是 porcelain 记录边界。
  for (const field of output.split("\0")) {
    if (field === "") {
      flushRecord();
    } else {
      record.push(field);
    }
  }
  if (record.length > 0) flushRecord();
  if (worktrees.length > MAX_PROJECT_WORKTREES) {
    throw new Error("Git worktree count exceeded the limit");
  }
  return worktrees;
}

export async function readProjectWorktrees(
  projectRoot: string,
  gitCommandExecutor: GitCommandExecutor = executeGit,
): Promise<ProjectGitWorktreePage> {
  if (!isAbsolute(projectRoot)) {
    throw new TypeError("Project root must be absolute");
  }
  const repositoryRoot = await realpath(projectRoot);
  const output = await gitCommandExecutor(repositoryRoot, [
    "worktree",
    "list",
    "--porcelain",
    "-z",
  ]);
  return { worktrees: parseGitWorktreeList(output, repositoryRoot) };
}

function worktreeDirectorySlug(branch: string): string {
  const slug = branch.replace(/[^\p{Letter}\p{Number}._-]+/gu, "-").replace(/^[.-]+|[.-]+$/gu, "");
  return slug || "worktree";
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function resolveAvailableWorktreePath(repositoryRoot: string, branch: string) {
  const basePath = join(
    dirname(repositoryRoot),
    `${basename(repositoryRoot)}-${worktreeDirectorySlug(branch)}`,
  );
  for (let suffix = 1; suffix <= MAX_PROJECT_WORKTREES; suffix += 1) {
    const candidate = suffix === 1 ? basePath : `${basePath}-${String(suffix)}`;
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new GitWorktreeError("CREATE_FAILED", "No available Git worktree path was found");
}

export async function createProjectWorktree(
  projectRoot: string,
  request: CreateProjectWorktreeRequest,
  gitCommandExecutor: GitCommandExecutor = executeGit,
  readStatus: GitStatusReader = readGitWorkingTreeStatus,
): Promise<ProjectGitWorktree> {
  if (!isAbsolute(projectRoot)) {
    throw new TypeError("Project root must be absolute");
  }
  const repositoryRoot = await realpath(projectRoot);
  const status = await readStatus(repositoryRoot, gitCommandExecutor);
  if (status.repositoryMode !== "root") {
    throw new GitWorktreeError("REPOSITORY_READ_ONLY", "Git repository mode is read-only");
  }
  if (status.snapshot !== request.expectedSnapshot) {
    throw new GitWorktreeError("SNAPSHOT_MISMATCH", "Git working tree snapshot changed");
  }

  try {
    const checkedBranch = await gitCommandExecutor(repositoryRoot, [
      "check-ref-format",
      "--branch",
      request.branch,
    ]);
    if (checkedBranch.trim() !== request.branch) throw new Error("Git branch name was expanded");
  } catch (error) {
    throw new GitWorktreeError(
      "INVALID_BRANCH_NAME",
      originalErrorMessage(error, "Git branch name is invalid"),
    );
  }

  const targetPath = await resolveAvailableWorktreePath(repositoryRoot, request.branch);
  const arguments_ = status.branches.includes(request.branch)
    ? ["worktree", "add", "--", targetPath, request.branch]
    : ["worktree", "add", "-b", request.branch, "--", targetPath, "HEAD"];
  try {
    await gitCommandExecutor(repositoryRoot, arguments_);
  } catch (error) {
    throw new GitWorktreeError(
      "CREATE_FAILED",
      originalErrorMessage(error, "Git worktree creation failed"),
    );
  }
  invalidateGitBranchCache(repositoryRoot);
  return { branch: request.branch, current: false, path: targetPath };
}

export async function resolveProjectWorktree(
  projectRoot: string,
  requestedPath: string,
  readWorktrees: GitWorktreeReader = readProjectWorktrees,
): Promise<ProjectGitWorktree> {
  if (!isAbsolute(projectRoot) || !isAbsolute(requestedPath)) {
    throw new TypeError("Project and worktree paths must be absolute");
  }
  const [repositoryRoot, targetPath] = await Promise.all([
    realpath(projectRoot),
    realpath(requestedPath).catch(() => undefined),
  ]);
  if (targetPath === undefined) {
    throw new GitWorktreeError("WORKTREE_NOT_FOUND", "Git worktree was not found");
  }
  const { worktrees } = await readWorktrees(repositoryRoot);
  const worktree = worktrees.find((candidate) => resolve(candidate.path) === targetPath);
  if (worktree === undefined) {
    throw new GitWorktreeError("WORKTREE_NOT_FOUND", "Git worktree was not found");
  }
  if (worktree.current) {
    throw new GitWorktreeError("ALREADY_ACTIVE", "Git worktree is already active");
  }
  return worktree;
}
