import { Buffer } from "node:buffer";
import { lstat } from "node:fs/promises";
import { join } from "node:path";

import type {
  ProjectGitCommitFile,
  ProjectGitCommitFileDiff,
  ProjectGitCommitFileDiffQuery,
  ProjectGitCommitFilesPage,
  ProjectGitCommitFilesQuery,
} from "@codexly/protocol";

import { executeGit, type GitCommandExecutor } from "./git-command.js";
import { originalErrorMessage } from "./error-message.js";
import {
  GitRepositorySelectionError,
  resolveProjectGitRepositoryRoot,
} from "./git-working-tree.js";

const GIT_COMMIT_FILES_PAGE_SIZE = 100;
const MAX_GIT_COMMIT_FILE_DIFF_BYTES = 512 * 1024;

export class GitCommitReviewError extends Error {
  public constructor(
    public readonly code: "INVALID_CURSOR" | "REPOSITORY_NOT_FOUND" | "UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "GitCommitReviewError";
  }
}

function parseCursor(cursor: string | undefined): number {
  if (cursor === undefined) {
    return 0;
  }
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new GitCommitReviewError("INVALID_CURSOR", "Git commit files cursor is invalid");
  }
  return offset;
}

function parseCommitFiles(output: string): ProjectGitCommitFile[] {
  const fields = output.split("\0");
  const files: ProjectGitCommitFile[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const status = fields[index];
    const path = fields[index + 1];
    if (status === "" || path === "" || status === undefined || path === undefined) {
      break;
    }
    const kind = status === "A" ? "create" : status === "D" ? "delete" : "update";
    files.push({ kind, path });
  }
  return files;
}

async function resolveRepository(projectRoot: string, repository: string | undefined) {
  try {
    const repositoryRoot = await resolveProjectGitRepositoryRoot(projectRoot, repository);
    // simple-git 会向父目录查找仓库；必须确认最终目标自身就是已选择的 Git 根目录。
    await lstat(join(repositoryRoot, ".git"));
    return repositoryRoot;
  } catch (error) {
    if (
      error instanceof GitRepositorySelectionError ||
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new GitCommitReviewError("REPOSITORY_NOT_FOUND", "Git repository was not found");
    }
    throw error;
  }
}

export async function readProjectGitCommitFiles(
  projectRoot: string,
  query: Omit<ProjectGitCommitFilesQuery, "rootPath">,
  gitCommandExecutor: GitCommandExecutor = executeGit,
): Promise<ProjectGitCommitFilesPage> {
  const offset = parseCursor(query.cursor);
  const repositoryRoot = await resolveRepository(projectRoot, query.repository);
  try {
    const output = await gitCommandExecutor(repositoryRoot, [
      "diff-tree",
      "--root",
      "--no-commit-id",
      "--name-status",
      "-z",
      "-r",
      "--no-renames",
      query.sha,
      "--",
    ]);
    const files = parseCommitFiles(output);
    const page = files.slice(offset, offset + GIT_COMMIT_FILES_PAGE_SIZE);
    return {
      files: page,
      nextCursor:
        offset + page.length < files.length ? String(offset + GIT_COMMIT_FILES_PAGE_SIZE) : null,
    };
  } catch (error) {
    if (error instanceof GitCommitReviewError) {
      throw error;
    }
    throw new GitCommitReviewError(
      "UNAVAILABLE",
      originalErrorMessage(error, "Git commit files are unavailable"),
    );
  }
}

function truncateUtf8(value: string): ProjectGitCommitFileDiff {
  const bytes = Buffer.from(value);
  if (bytes.byteLength <= MAX_GIT_COMMIT_FILE_DIFF_BYTES) {
    return { diff: value, truncated: false };
  }
  let diff = bytes.subarray(0, MAX_GIT_COMMIT_FILE_DIFF_BYTES).toString("utf8");
  while (Buffer.byteLength(diff) > MAX_GIT_COMMIT_FILE_DIFF_BYTES) {
    diff = diff.slice(0, -1);
  }
  return { diff, truncated: true };
}

export async function readProjectGitCommitFileDiff(
  projectRoot: string,
  query: Omit<ProjectGitCommitFileDiffQuery, "rootPath">,
  gitCommandExecutor: GitCommandExecutor = executeGit,
): Promise<ProjectGitCommitFileDiff> {
  const repositoryRoot = await resolveRepository(projectRoot, query.repository);
  try {
    const output = await gitCommandExecutor(repositoryRoot, [
      "show",
      "--format=",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "--unified=3",
      query.sha,
      "--",
      query.path,
    ]);
    return truncateUtf8(output);
  } catch (error) {
    throw new GitCommitReviewError(
      "UNAVAILABLE",
      originalErrorMessage(error, "Git commit file diff is unavailable"),
    );
  }
}
