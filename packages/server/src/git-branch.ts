import { realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";

import type {
  CreateProjectBranchRequest,
  ProjectGitStatus,
  SwitchProjectBranchRequest,
} from "@code-agent/protocol";

import { executeGit, type GitCommandExecutor } from "./git-command.js";
import { originalErrorMessage } from "./error-message.js";
import { invalidateGitBranchCache, readGitWorkingTreeStatus } from "./git-working-tree.js";

export type GitBranchErrorCode =
  | "ALREADY_ACTIVE"
  | "BRANCH_ALREADY_EXISTS"
  | "BRANCH_NOT_FOUND"
  | "CREATE_FAILED"
  | "INVALID_BRANCH_NAME"
  | "REPOSITORY_READ_ONLY"
  | "SNAPSHOT_MISMATCH"
  | "SWITCH_FAILED";

export class GitBranchError extends Error {
  public readonly code: GitBranchErrorCode;

  public constructor(code: GitBranchErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "GitBranchError";
  }
}

type GitStatusReader = (
  projectRoot: string,
  gitCommandExecutor?: GitCommandExecutor,
) => Promise<ProjectGitStatus>;

export async function switchProjectBranch(
  projectRoot: string,
  request: SwitchProjectBranchRequest,
  gitCommandExecutor: GitCommandExecutor = executeGit,
  readStatus: GitStatusReader = readGitWorkingTreeStatus,
): Promise<ProjectGitStatus> {
  if (!isAbsolute(projectRoot)) {
    throw new TypeError("Project root must be absolute");
  }

  // Mutation 与状态读取共享同一个真实根目录，避免切换期间符号链接改变执行边界。
  const repositoryRoot = await realpath(projectRoot);
  const status = await readStatus(repositoryRoot, gitCommandExecutor);
  if (status.repositoryMode !== "root") {
    throw new GitBranchError("REPOSITORY_READ_ONLY", "Git repository mode is read-only");
  }
  if (status.snapshot !== request.expectedSnapshot) {
    throw new GitBranchError("SNAPSHOT_MISMATCH", "Git working tree snapshot changed");
  }
  if (!status.branches.includes(request.branch)) {
    throw new GitBranchError("BRANCH_NOT_FOUND", "Git branch is not available");
  }
  if (status.branch === request.branch) {
    throw new GitBranchError("ALREADY_ACTIVE", "Git branch is already active");
  }

  try {
    await gitCommandExecutor(repositoryRoot, ["switch", "--no-guess", request.branch]);
  } catch (error) {
    throw new GitBranchError(
      "SWITCH_FAILED",
      originalErrorMessage(error, "Git branch switch failed"),
    );
  }
  invalidateGitBranchCache(repositoryRoot);
  return readStatus(repositoryRoot, gitCommandExecutor);
}

export async function createProjectBranch(
  projectRoot: string,
  request: CreateProjectBranchRequest,
  gitCommandExecutor: GitCommandExecutor = executeGit,
  readStatus: GitStatusReader = readGitWorkingTreeStatus,
): Promise<ProjectGitStatus> {
  if (!isAbsolute(projectRoot)) {
    throw new TypeError("Project root must be absolute");
  }

  const repositoryRoot = await realpath(projectRoot);
  const status = await readStatus(repositoryRoot, gitCommandExecutor);
  if (status.repositoryMode !== "root") {
    throw new GitBranchError("REPOSITORY_READ_ONLY", "Git repository mode is read-only");
  }
  if (status.snapshot !== request.expectedSnapshot) {
    throw new GitBranchError("SNAPSHOT_MISMATCH", "Git working tree snapshot changed");
  }
  if (status.branches.includes(request.branch)) {
    throw new GitBranchError("BRANCH_ALREADY_EXISTS", "Git branch already exists");
  }

  // Git 原生规则是分支名合法性的最终真相源，避免在 HTTP 层复制易漂移的规则。
  try {
    const checkedBranch = await gitCommandExecutor(repositoryRoot, [
      "check-ref-format",
      "--branch",
      request.branch,
    ]);
    if (checkedBranch.trim() !== request.branch) {
      throw new Error("Git branch name was expanded");
    }
  } catch (error) {
    throw new GitBranchError(
      "INVALID_BRANCH_NAME",
      originalErrorMessage(error, "Git branch name is invalid"),
    );
  }
  try {
    await gitCommandExecutor(repositoryRoot, ["switch", "-c", request.branch]);
  } catch (error) {
    throw new GitBranchError(
      "CREATE_FAILED",
      originalErrorMessage(error, "Git branch creation failed"),
    );
  }
  invalidateGitBranchCache(repositoryRoot);
  return readStatus(repositoryRoot, gitCommandExecutor);
}
