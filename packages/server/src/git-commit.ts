import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  AgentMutationError,
  CommitProjectChangesRequest,
  PushProjectCommitsRequest,
  PushProjectCommitsResponse,
  CommitProjectChangesResponse,
} from "@codexly/protocol";

import { executeGit } from "./git-mutation-command.js";
import { operateGitRemote } from "./git-remote.js";
import { originalErrorMessage } from "./error-message.js";
import { readGitWorkingTreeStatus, resolveProjectGitRepositoryRoot } from "./git-working-tree.js";

type GitCommitErrorCode = Extract<
  AgentMutationError["code"],
  "GIT_COMMIT_FAILED" | "GIT_PATH_UNAVAILABLE" | "GIT_REPOSITORY_UNAVAILABLE" | "GIT_STATUS_CHANGED"
>;

export class GitCommitError extends Error {
  public constructor(
    public readonly code: GitCommitErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GitCommitError";
  }
}

function literalPath(path: string): string {
  return `:(literal)${path}`;
}

export async function commitSelectedProjectChanges(
  projectRoot: string,
  request: CommitProjectChangesRequest,
): Promise<Omit<CommitProjectChangesResponse, "history" | "status">> {
  const repositoryRoot = await resolveProjectGitRepositoryRoot(
    projectRoot,
    request.repository,
  ).catch((error: unknown) => {
    throw new GitCommitError(
      "GIT_REPOSITORY_UNAVAILABLE",
      originalErrorMessage(error, "Git repository is unavailable"),
    );
  });
  const status = await readGitWorkingTreeStatus(repositoryRoot).catch((error: unknown) => {
    throw new GitCommitError(
      "GIT_REPOSITORY_UNAVAILABLE",
      originalErrorMessage(error, "Git repository is unavailable"),
    );
  });
  if (status.repositoryMode !== "root") {
    throw new GitCommitError(
      "GIT_REPOSITORY_UNAVAILABLE",
      "Git commits require a selected repository",
    );
  }
  if (status.snapshot !== request.expectedSnapshot) {
    throw new GitCommitError("GIT_STATUS_CHANGED", "Git changes changed before the commit");
  }

  const changedPaths = new Set([...status.staged, ...status.unstaged].map((change) => change.path));
  if (request.paths.some((path) => !changedPaths.has(path))) {
    throw new GitCommitError(
      "GIT_PATH_UNAVAILABLE",
      "A selected file is no longer available to commit",
    );
  }

  const selectedPaths = request.paths.map(literalPath);
  const stagedPaths = new Set(status.staged.map((change) => change.path));
  const selectedStagedPaths = request.paths.filter((path) => stagedPaths.has(path));
  const selectedUnstagedPaths = request.paths.filter((path) => !stagedPaths.has(path));
  const temporaryIndexRoot = await mkdtemp(join(tmpdir(), "codexly-git-index-"));
  const temporaryIndexEnvironment = {
    GIT_INDEX_FILE: join(temporaryIndexRoot, "index"),
  };

  try {
    // 从 HEAD 组装隔离索引，避免把未选择的暂存文件带入本次提交。
    await executeGit(repositoryRoot, ["read-tree", "HEAD"], "", temporaryIndexEnvironment);
    if (selectedStagedPaths.length > 0) {
      const stagedEntries = await executeGit(repositoryRoot, [
        "ls-files",
        "--stage",
        "-z",
        "--",
        ...selectedStagedPaths.map(literalPath),
      ]);
      await executeGit(
        repositoryRoot,
        ["update-index", "--force-remove", "--", ...selectedStagedPaths],
        "",
        temporaryIndexEnvironment,
      );
      if (stagedEntries.stdout.length > 0) {
        // 复制真实索引条目，使 MM 文件提交暂存版本并保留工作区版本。
        await executeGit(
          repositoryRoot,
          ["update-index", "-z", "--index-info"],
          stagedEntries.stdout,
          temporaryIndexEnvironment,
        );
      }
    }
    if (selectedUnstagedPaths.length > 0) {
      await executeGit(
        repositoryRoot,
        ["add", "--", ...selectedUnstagedPaths.map(literalPath)],
        "",
        temporaryIndexEnvironment,
      );
    }
    await executeGit(
      repositoryRoot,
      ["commit", "--file=-"],
      request.message,
      temporaryIndexEnvironment,
    );
    // 新 HEAD 落定后只校准已提交路径，保留其他文件原有的暂存状态。
    await executeGit(repositoryRoot, ["reset", "--quiet", "HEAD", "--", ...selectedPaths]);
  } catch (error) {
    throw new GitCommitError("GIT_COMMIT_FAILED", originalErrorMessage(error, "Git commit failed"));
  } finally {
    // 临时目录清理失败不能覆盖已经完成的 Git commit 结果。
    await rm(temporaryIndexRoot, { force: true, recursive: true }).catch(() => undefined);
  }

  const commitSha = (await executeGit(repositoryRoot, ["rev-parse", "HEAD"])).stdout.trim();
  const { pushStatus, pushError } =
    request.action === "commit_and_push"
      ? await pushConfiguredBranch(repositoryRoot)
      : { pushStatus: "not_requested" as const, pushError: null };

  return {
    branch: status.branch,
    commitSha,
    message: request.message,
    pushError,
    pushStatus,
  };
}

/** 复用提交并推送的执行路径，失败结果保留为可重试状态。 */
async function pushConfiguredBranch(
  repositoryRoot: string,
): Promise<{ pushStatus: "pushed" | "failed" | "not_configured"; pushError: string | null }> {
  try {
    await executeGit(repositoryRoot, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]);
  } catch (error) {
    return {
      pushStatus: "not_configured",
      pushError: originalErrorMessage(error, "Git upstream is not configured"),
    };
  }
  try {
    await executeGit(repositoryRoot, ["push"]);
    return { pushStatus: "pushed", pushError: null };
  } catch (error) {
    return { pushStatus: "failed", pushError: originalErrorMessage(error, "Git push failed") };
  }
}

export async function pushProjectCommits(
  projectRoot: string,
  request: PushProjectCommitsRequest,
): Promise<PushProjectCommitsResponse> {
  const repositoryRoot = await resolveProjectGitRepositoryRoot(
    projectRoot,
    request.repository,
  ).catch((error: unknown) => {
    throw new GitCommitError(
      "GIT_REPOSITORY_UNAVAILABLE",
      originalErrorMessage(error, "Git repository is unavailable"),
    );
  });
  const status = await readGitWorkingTreeStatus(repositoryRoot);
  if (status.repositoryMode !== "root") {
    throw new GitCommitError(
      "GIT_REPOSITORY_UNAVAILABLE",
      "Git pushes require a selected repository",
    );
  }
  // 纯网络动作只校验将推送的 HEAD 和分支；工作区继续编辑不影响已有提交。
  const validatesHead =
    ["push", "publish", "fetch"].includes(request.action ?? "") &&
    request.expectedHead !== undefined &&
    request.expectedBranch !== undefined;
  const stale = validatesHead
    ? status.branch !== request.expectedBranch ||
      (await executeGit(repositoryRoot, ["rev-parse", "HEAD"])).stdout.trim() !==
        request.expectedHead
    : status.snapshot !== request.expectedSnapshot;
  if (stale) {
    throw new GitCommitError("GIT_STATUS_CHANGED", "Git status changed before the push");
  }
  if (request.action !== undefined) return operateGitRemote(repositoryRoot, request);
  return { branch: status.branch, ...(await pushConfiguredBranch(repositoryRoot)) };
}
