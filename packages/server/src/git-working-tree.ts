import { createHash } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

import type { ProjectGitStatus, ProjectGitStatusQuery } from "@code-agent/protocol";

import { executeGit, type GitCommandExecutor } from "./git-command.js";
import {
  MAX_FILE_IO_CONCURRENCY,
  MAX_GIT_COMMAND_CONCURRENCY,
  MAX_WORKING_TREE_FILES,
  WorkingTreeReadBudget,
  applyDiffBudget,
  createConcurrencyLimiter,
  createUntrackedFileDiff,
  mapWithConcurrency,
  parsePorcelainStatus,
  readTrackedFileChanges,
  resolveChangeKind,
  type GitFileChange,
  type GitWorkingTreeChanges,
  type WorkingTreeEntry,
} from "./git-working-tree-diff.js";

const BRANCH_CACHE_TTL_MS = 60_000;
const MAX_BRANCH_CACHE_ENTRIES = 128;

type BranchCandidates = Readonly<{
  localRefsOutput: string;
  refsOutput: string;
  remoteHeadOutput: string;
}>;

type BranchCacheEntry = Readonly<{
  expiresAt: number;
  value: Promise<BranchCandidates>;
}>;

const branchCandidatesByRepository = new Map<string, BranchCacheEntry>();

export function invalidateGitBranchCache(repositoryRoot: string): void {
  branchCandidatesByRepository.delete(repositoryRoot);
}

export function invalidateProjectGitBranchCache(projectRoot: string): void {
  for (const repositoryRoot of branchCandidatesByRepository.keys()) {
    if (repositoryRoot === projectRoot || dirname(repositoryRoot) === projectRoot) {
      branchCandidatesByRepository.delete(repositoryRoot);
    }
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

export class GitRepositorySelectionError extends Error {
  public readonly code = "REPOSITORY_NOT_FOUND";

  public constructor() {
    super("Git repository was not found");
    this.name = "GitRepositorySelectionError";
  }
}

export async function resolveProjectGitRepositoryRoot(
  projectRoot: string,
  repository?: string,
): Promise<string> {
  if (!isAbsolute(projectRoot)) {
    throw new TypeError("Project root must be absolute");
  }
  const resolvedProjectRoot = await realpath(projectRoot);
  if (repository === undefined) {
    return resolvedProjectRoot;
  }

  // 子仓库必须是 Project 的真实直属目录；白名单解析禁止嵌套路径和符号链接跳转。
  if (
    repository.includes("/") ||
    repository.includes("\\") ||
    (await hasGitMetadata(resolvedProjectRoot))
  ) {
    throw new GitRepositorySelectionError();
  }
  const candidate = join(resolvedProjectRoot, repository);
  try {
    const candidateStat = await lstat(candidate);
    if (!candidateStat.isDirectory()) {
      throw new GitRepositorySelectionError();
    }
    const resolvedCandidate = await realpath(candidate);
    if (
      dirname(resolvedCandidate) !== resolvedProjectRoot ||
      !(await hasGitMetadata(resolvedCandidate))
    ) {
      throw new GitRepositorySelectionError();
    }
    return resolvedCandidate;
  } catch (error) {
    if (error instanceof GitRepositorySelectionError) {
      throw error;
    }
    throw new GitRepositorySelectionError();
  }
}

async function readRepositoryWorkingTreeEntries(
  repositoryRoot: string,
  gitCommandExecutor: GitCommandExecutor,
): Promise<readonly WorkingTreeEntry[]> {
  const statusOutput = await gitCommandExecutor(repositoryRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  return parsePorcelainStatus(statusOutput, MAX_WORKING_TREE_FILES);
}

async function readUntrackedFileChanges(
  repositoryRoot: string,
  entries: readonly WorkingTreeEntry[],
  budget: WorkingTreeReadBudget,
): Promise<GitFileChange[]> {
  const changes: GitFileChange[] = [];
  for (let offset = 0; offset < entries.length; offset += MAX_FILE_IO_CONCURRENCY) {
    const batch = entries.slice(offset, offset + MAX_FILE_IO_CONCURRENCY);
    if (!budget.hasDiffCapacity) {
      changes.push(
        ...batch.map((entry) => ({ diff: "", kind: "create" as const, path: entry.path })),
      );
      continue;
    }

    // 每批最多保留固定数量的文件正文；按原始顺序扣减总预算，保证快照不受 I/O 完成顺序影响。
    const batchChanges = await Promise.all(
      batch.map((entry) => createUntrackedFileDiff(repositoryRoot, entry.path)),
    );
    changes.push(...applyDiffBudget(batchChanges, budget));
  }
  return changes;
}

async function materializeRepositoryWorkingTreeStatus(
  repositoryRoot: string,
  entries: readonly WorkingTreeEntry[],
  gitCommandExecutor: GitCommandExecutor,
  budget: WorkingTreeReadBudget,
  includeDiff: boolean,
): Promise<GitWorkingTreeChanges> {
  const stagedEntries = entries.filter(
    (entry) => entry.indexStatus !== " " && entry.indexStatus !== "?" && entry.indexStatus !== "!",
  );
  const trackedUnstagedEntries = entries.filter(
    (entry) =>
      entry.indexStatus !== "?" &&
      entry.workingTreeStatus !== " " &&
      entry.workingTreeStatus !== "!",
  );
  const untrackedEntries = entries.filter(
    (entry) => entry.indexStatus === "?" && entry.workingTreeStatus === "?",
  );

  if (!includeDiff) {
    // 周期刷新只保留文件位置和类型，禁止启动 Diff 命令或读取未跟踪文件正文。
    return {
      staged: stagedEntries.map((entry) => ({
        diff: "",
        kind: resolveChangeKind(entry.indexStatus),
        path: entry.path,
      })),
      unstaged: [...trackedUnstagedEntries, ...untrackedEntries].map((entry) => ({
        diff: "",
        kind: resolveChangeKind(entry.workingTreeStatus),
        path: entry.path,
      })),
    };
  }

  // 同一仓库仍批量读取 tracked Diff；共享限流器同时约束多个子仓库的进程峰值。
  const [rawStaged, rawTrackedUnstaged] = await Promise.all([
    readTrackedFileChanges(repositoryRoot, stagedEntries, "staged", gitCommandExecutor),
    readTrackedFileChanges(repositoryRoot, trackedUnstagedEntries, "unstaged", gitCommandExecutor),
  ]);
  const staged = applyDiffBudget(rawStaged, budget);
  const trackedUnstaged = applyDiffBudget(rawTrackedUnstaged, budget);
  const untracked = await readUntrackedFileChanges(repositoryRoot, untrackedEntries, budget);

  return { staged, unstaged: [...trackedUnstaged, ...untracked] };
}

async function readOptionalGit(
  repositoryRoot: string,
  arguments_: readonly string[],
  gitCommandExecutor: GitCommandExecutor,
): Promise<string> {
  try {
    return await gitCommandExecutor(repositoryRoot, arguments_);
  } catch {
    return "";
  }
}

async function readRepositoryBranches(
  repositoryRoot: string,
  gitCommandExecutor: GitCommandExecutor,
): Promise<Pick<ProjectGitStatus, "baseBranches" | "branch" | "branches">> {
  const branchOutputPromise = readOptionalGit(
    repositoryRoot,
    ["branch", "--show-current"],
    gitCommandExecutor,
  );
  const now = Date.now();
  let cachedCandidates = branchCandidatesByRepository.get(repositoryRoot);
  if (cachedCandidates === undefined || cachedCandidates.expiresAt <= now) {
    const value = Promise.all([
      readOptionalGit(
        repositoryRoot,
        ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
        gitCommandExecutor,
      ),
      readOptionalGit(
        repositoryRoot,
        ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"],
        gitCommandExecutor,
      ),
      readOptionalGit(
        repositoryRoot,
        ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
        gitCommandExecutor,
      ),
    ]).then(([localRefsOutput, refsOutput, remoteHeadOutput]) => ({
      localRefsOutput,
      refsOutput,
      remoteHeadOutput,
    }));
    cachedCandidates = { expiresAt: now + BRANCH_CACHE_TTL_MS, value };
    branchCandidatesByRepository.set(repositoryRoot, cachedCandidates);
    // 缓存只服务活跃仓库；达到上限时按插入顺序淘汰最早条目。
    if (branchCandidatesByRepository.size > MAX_BRANCH_CACHE_ENTRIES) {
      const oldestRepository = branchCandidatesByRepository.keys().next().value;
      if (oldestRepository !== undefined) branchCandidatesByRepository.delete(oldestRepository);
    }
    void value.catch(() => {
      if (branchCandidatesByRepository.get(repositoryRoot)?.value === value) {
        branchCandidatesByRepository.delete(repositoryRoot);
      }
    });
  }
  const [branchOutput, { localRefsOutput, refsOutput, remoteHeadOutput }] = await Promise.all([
    branchOutputPromise,
    cachedCandidates.value,
  ]);
  const branch = branchOutput.trim() || null;
  const localBranches = [...new Set(localRefsOutput.split("\n").map((ref) => ref.trim()))]
    .filter((ref) => ref !== "")
    .toSorted((left, right) => left.localeCompare(right));
  if (branch !== null) {
    if (localBranches.includes(branch)) localBranches.splice(localBranches.indexOf(branch), 1);
    localBranches.unshift(branch);
  }
  const branches = [...new Set(refsOutput.split("\n").map((ref) => ref.trim()))]
    .filter((ref) => ref !== "" && !ref.endsWith("/HEAD") && ref !== branch)
    .toSorted((left, right) => left.localeCompare(right));
  const remoteDefaultBranch = remoteHeadOutput.trim().replace(/^refs\/remotes\//u, "");
  const preferredBranch = [
    remoteDefaultBranch,
    "origin/main",
    "main",
    "origin/master",
    "master",
  ].find((candidate) => candidate !== "" && branches.includes(candidate));

  if (preferredBranch !== undefined) {
    branches.splice(branches.indexOf(preferredBranch), 1);
    branches.unshift(preferredBranch);
  }
  return { baseBranches: branches, branch, branches: localBranches };
}

function prefixRepositoryPath(repositoryName: string, change: GitFileChange): GitFileChange {
  return { ...change, path: `${repositoryName}/${change.path}` };
}

async function readImmediateChildRepositoryStatuses(
  projectRoot: string,
  gitCommandExecutor: GitCommandExecutor,
  budget: WorkingTreeReadBudget,
  includeDiff: boolean,
): Promise<GitWorkingTreeChanges | undefined> {
  const childDirectories = (await readdir(projectRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .toSorted((left, right) => left.name.localeCompare(right.name));
  const repositoryCandidates = await mapWithConcurrency(
    childDirectories,
    MAX_FILE_IO_CONCURRENCY,
    async (entry) => {
      const repositoryRoot = join(projectRoot, entry.name);
      return (await hasGitMetadata(repositoryRoot))
        ? { name: entry.name, root: repositoryRoot }
        : null;
    },
  );
  const repositories = repositoryCandidates.filter(
    (candidate): candidate is { name: string; root: string } => candidate !== null,
  );
  if (repositories.length === 0) {
    return undefined;
  }

  const staged: GitFileChange[] = [];
  const unstaged: GitFileChange[] = [];
  // 每批只保留固定数量的 Porcelain 结果，并按仓库排序分配全局预算。
  for (
    let offset = 0;
    offset < repositories.length && budget.hasFileCapacity;
    offset += MAX_GIT_COMMAND_CONCURRENCY
  ) {
    const repositoryBatch = repositories.slice(offset, offset + MAX_GIT_COMMAND_CONCURRENCY);
    const repositoryEntries = await Promise.all(
      repositoryBatch.map((repository) =>
        readRepositoryWorkingTreeEntries(repository.root, gitCommandExecutor),
      ),
    );
    for (const [repositoryIndex, repository] of repositoryBatch.entries()) {
      const selectedEntries = budget.takeEntries(repositoryEntries[repositoryIndex] ?? []);
      const status = await materializeRepositoryWorkingTreeStatus(
        repository.root,
        selectedEntries,
        gitCommandExecutor,
        budget,
        includeDiff,
      );
      staged.push(...status.staged.map((change) => prefixRepositoryPath(repository.name, change)));
      unstaged.push(
        ...status.unstaged.map((change) => prefixRepositoryPath(repository.name, change)),
      );
    }
  }

  return { staged, unstaged };
}

export async function readGitWorkingTreeStatus(
  projectRoot: string,
  gitCommandExecutor: GitCommandExecutor = executeGit,
  options: Readonly<{ includeDiff?: boolean }> = {},
): Promise<ProjectGitStatus> {
  if (!isAbsolute(projectRoot)) {
    throw new TypeError("Project root must be absolute");
  }

  // 每次读取都重新解析真实路径，避免 Project 根目录被符号链接替换后越过配置边界。
  const resolvedProjectRoot = await realpath(projectRoot);
  const budget = new WorkingTreeReadBudget();
  const limitGitCommand = createConcurrencyLimiter(MAX_GIT_COMMAND_CONCURRENCY);
  const limitedGitCommandExecutor: GitCommandExecutor = (repositoryRoot, arguments_) =>
    limitGitCommand(() => gitCommandExecutor(repositoryRoot, arguments_));
  let status: GitWorkingTreeChanges;
  let repositoryBranches: Pick<ProjectGitStatus, "baseBranches" | "branch" | "branches"> = {
    baseBranches: [],
    branch: null,
    branches: [],
  };
  let repositoryMode: ProjectGitStatus["repositoryMode"] = "root";
  if (await hasGitMetadata(resolvedProjectRoot)) {
    const [entries, branches] = await Promise.all([
      readRepositoryWorkingTreeEntries(resolvedProjectRoot, limitedGitCommandExecutor),
      readRepositoryBranches(resolvedProjectRoot, limitedGitCommandExecutor),
    ]);
    status = await materializeRepositoryWorkingTreeStatus(
      resolvedProjectRoot,
      budget.takeEntries(entries),
      limitedGitCommandExecutor,
      budget,
      options.includeDiff === true,
    );
    repositoryBranches = branches;
  } else {
    // 只认 Project 自身的 .git，避免把上级仓库误判为可提交根仓库。
    const childStatus = await readImmediateChildRepositoryStatuses(
      resolvedProjectRoot,
      limitedGitCommandExecutor,
      budget,
      options.includeDiff === true,
    );
    if (childStatus === undefined) {
      // 非 Git 是可恢复的 Project 状态，手动刷新时仍需允许重新探测仓库。
      status = { staged: [], unstaged: [] };
      repositoryMode = "none";
    } else {
      status = childStatus;
      repositoryMode = "children";
    }
  }

  const comparePaths = (left: GitFileChange, right: GitFileChange) =>
    left.path.localeCompare(right.path);
  const staged = status.staged.toSorted(comparePaths);
  const unstaged = status.unstaged.toSorted(comparePaths);
  const snapshotHash = createHash("sha256");
  snapshotHash
    .update(repositoryBranches.branch ?? "")
    .update("\0")
    .update(repositoryMode);
  const fingerprintChanges = async (
    location: "staged" | "unstaged",
    changes: readonly GitFileChange[],
  ) =>
    mapWithConcurrency(changes, MAX_FILE_IO_CONCURRENCY, async (change) => {
      let metadata = "missing";
      try {
        const stats = await lstat(join(resolvedProjectRoot, change.path), { bigint: true });
        metadata = [stats.mode, stats.size, stats.mtimeNs, stats.ctimeNs].join(":");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      return `${location}\0${change.kind}\0${change.path}\0${metadata}\0`;
    });
  // 只哈希稳定的小字段和文件活动元数据，避免把完整 Diff 复制进 JSON 字符串。
  for (const fingerprint of await fingerprintChanges("staged", staged)) {
    snapshotHash.update(fingerprint);
  }
  for (const fingerprint of await fingerprintChanges("unstaged", unstaged)) {
    snapshotHash.update(fingerprint);
  }
  const snapshot = snapshotHash.digest("hex");
  return {
    ...repositoryBranches,
    repositoryMode,
    snapshot,
    staged,
    unstaged,
  };
}

export async function readProjectGitStatus(
  projectRoot: string,
  query: Omit<ProjectGitStatusQuery, "rootPath"> = {},
  gitCommandExecutor: GitCommandExecutor = executeGit,
): Promise<ProjectGitStatus> {
  const repositoryRoot = await resolveProjectGitRepositoryRoot(projectRoot, query.repository);
  return readGitWorkingTreeStatus(repositoryRoot, gitCommandExecutor, {
    includeDiff: query.includeDiff === true,
  });
}
