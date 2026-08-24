import { spawn } from "node:child_process";

import type {
  AgentMutationError,
  CommitProjectChangesRequest,
  CommitProjectChangesResponse,
} from "@codexly/protocol";

import { createGitEnvironment } from "./git-command.js";
import { originalErrorMessage } from "./error-message.js";
import { readGitWorkingTreeStatus, resolveProjectGitRepositoryRoot } from "./git-working-tree.js";

const MAX_GIT_OUTPUT_BYTES = 10 * 1024 * 1024;
const GIT_COMMAND_TIMEOUT_MS = 55_000;

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

function literalPath(path: string): string {
  return `:(literal)${path}`;
}

async function executeGit(
  repositoryRoot: string,
  arguments_: readonly string[],
  input = "",
): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    const consumesInput = input !== "";
    const child = spawn("git", ["-C", repositoryRoot, ...arguments_], {
      env: { ...createGitEnvironment(), GIT_TERMINAL_PROMPT: "0" },
      shell: false,
      // 无输入命令不创建 stdin pipe，避免短命令退出后写端异步触发 EPIPE。
      stdio: [consumesInput ? "pipe" : "ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
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
        child.kill("SIGKILL");
        finish(new GitCommandError(null, "Git command output exceeded the limit"));
        return;
      }
      target.push(chunk);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new GitCommandError(null, "Git command timed out"));
    }, GIT_COMMAND_TIMEOUT_MS);

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
      finish(error);
    });
    child.on("close", (exitCode) => {
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

export async function commitSelectedProjectChanges(
  projectRoot: string,
  request: CommitProjectChangesRequest,
): Promise<CommitProjectChangesResponse> {
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
  const untrackedPaths = status.unstaged
    .filter(
      (change) =>
        change.kind === "create" &&
        !stagedPaths.has(change.path) &&
        request.paths.includes(change.path),
    )
    .map((change) => literalPath(change.path));

  if (untrackedPaths.length > 0) {
    await executeGit(repositoryRoot, ["add", "--intent-to-add", "--", ...untrackedPaths]).catch(
      (error: unknown) => {
        throw new GitCommitError(
          "GIT_COMMIT_FAILED",
          originalErrorMessage(error, "Selected files could not be prepared"),
        );
      },
    );
  }

  try {
    await executeGit(
      repositoryRoot,
      ["commit", "--only", "--file=-", "--", ...selectedPaths],
      request.message,
    );
  } catch (error) {
    if (untrackedPaths.length > 0) {
      await executeGit(repositoryRoot, ["reset", "--", ...untrackedPaths]).catch(() => undefined);
    }
    throw new GitCommitError("GIT_COMMIT_FAILED", originalErrorMessage(error, "Git commit failed"));
  }

  const commitSha = (await executeGit(repositoryRoot, ["rev-parse", "HEAD"])).stdout.trim();
  let pushStatus: CommitProjectChangesResponse["pushStatus"] = "not_requested";
  let pushError: string | null = null;
  if (request.action === "commit_and_push") {
    try {
      await executeGit(repositoryRoot, [
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{upstream}",
      ]);
      try {
        await executeGit(repositoryRoot, ["push"]);
        pushStatus = "pushed";
      } catch (error) {
        pushStatus = "failed";
        pushError = originalErrorMessage(error, "Git push failed");
      }
    } catch (error) {
      pushStatus = "not_configured";
      pushError = originalErrorMessage(error, "Git upstream is not configured");
    }
  }

  return {
    branch: status.branch,
    commitSha,
    message: request.message,
    pushError,
    pushStatus,
  };
}
