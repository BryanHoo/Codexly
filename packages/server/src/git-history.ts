import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import type {
  ProjectGitCommit,
  ProjectGitHistoryPage,
  ProjectGitHistoryQuery,
} from "@code-agent/protocol";

import { executeGit, type GitCommandExecutor } from "./git-command.js";

const GIT_HISTORY_PAGE_SIZE = 20;
const MAX_GIT_HISTORY_REPOSITORIES = 256;
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

async function listChildRepositories(projectRoot: string): Promise<string[]> {
  const entries = (await readdir(projectRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .toSorted((left, right) => left.name.localeCompare(right.name));
  const repositories: string[] = [];
  for (const entry of entries) {
    if (repositories.length === MAX_GIT_HISTORY_REPOSITORIES) {
      break;
    }
    if (await hasGitMetadata(join(projectRoot, entry.name))) {
      repositories.push(entry.name);
    }
  }
  return repositories;
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
  return /does not have any commits|unknown revision|bad revision ['"]?HEAD/iu.test(message);
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
    const [branch, output] = await Promise.all([
      branchPromise,
      gitCommandExecutor(repositoryRoot, [
        "log",
        `--max-count=${String(GIT_HISTORY_PAGE_SIZE + 1)}`,
        `--skip=${String(offset)}`,
        "--format=%H%x00%an%x00%ae%x00%aI%x00%s%x00",
        "HEAD",
      ]),
    ]);
    const parsedCommits = parseGitHistory(output);
    return {
      branch,
      commits: parsedCommits.slice(0, GIT_HISTORY_PAGE_SIZE),
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

export async function readProjectGitHistory(
  projectRoot: string,
  query: Omit<ProjectGitHistoryQuery, "rootPath"> = {},
  gitCommandExecutor: GitCommandExecutor = executeGit,
): Promise<ProjectGitHistoryPage> {
  if (!isAbsolute(projectRoot)) {
    throw new TypeError("Project root must be absolute");
  }

  // 重新解析真实根目录，子仓库只允许从直属目录白名单中选择。
  const resolvedProjectRoot = await realpath(projectRoot);
  const offset = parseCursor(query.cursor);
  if (await hasGitMetadata(resolvedProjectRoot)) {
    if (query.repository !== undefined) {
      throw new GitHistoryError("REPOSITORY_NOT_FOUND", "Git repository was not found");
    }
    const page = await readRepositoryPage(resolvedProjectRoot, offset, gitCommandExecutor);
    return { ...page, repositories: [], repository: null, repositoryMode: "root" };
  }

  const repositories = await listChildRepositories(resolvedProjectRoot);
  const repository = query.repository ?? repositories[0];
  if (repository === undefined || !repositories.includes(repository)) {
    throw new GitHistoryError("REPOSITORY_NOT_FOUND", "Git repository was not found");
  }
  const page = await readRepositoryPage(
    join(resolvedProjectRoot, repository),
    offset,
    gitCommandExecutor,
  );
  return { ...page, repositories, repository, repositoryMode: "children" };
}
