import type { DiscardProjectChangesRequest, ProjectGitStatus } from "@codexly/protocol";
import { GitCommitError } from "./git-commit.js";
import { executeGit } from "./git-mutation-command.js";
import { readGitWorkingTreeStatus, resolveProjectGitRepositoryRoot } from "./git-working-tree.js";

/** 仅丢弃明确选中的路径；不使用整仓 reset/clean，不跟随符号链接删除目录。 */
export async function discardSelectedProjectChanges(
  root: string,
  request: DiscardProjectChangesRequest,
): Promise<ProjectGitStatus> {
  const repo = await resolveProjectGitRepositoryRoot(root, request.repository);
  const status = await readGitWorkingTreeStatus(repo);
  if (status.repositoryMode !== "root" || status.snapshot !== request.expectedSnapshot)
    throw new GitCommitError(
      "GIT_STATUS_CHANGED",
      "Git changes changed; refresh before discarding",
    );
  const changed = new Set([...status.staged, ...status.unstaged].map((change) => change.path));
  if (
    !request.paths.length ||
    request.paths.length > 500 ||
    request.paths.some((path) => !changed.has(path))
  )
    throw new GitCommitError("GIT_PATH_UNAVAILABLE", "Selected Git paths are unavailable");
  const paths = new Set(request.paths);
  const originals = new Set<string>();
  // Web 展示模型不包含 rename 源路径，从完整 NUL 状态中补齐；禁止按空格或换行切分文件名。
  const records = (
    await executeGit(repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])
  ).stdout.split("\0");
  for (let i = 0; i < records.length; i++) {
    const entry = records[i] ?? "";
    if (/^[RC]|^.[RC]/.test(entry)) {
      const original = records[++i];
      if (
        (entry.startsWith("R") || entry.startsWith("R", 1)) &&
        paths.has(entry.slice(3)) &&
        original
      ) {
        paths.add(original);
        originals.add(original);
      }
    }
  }
  const literal = [...paths].map((path) => `:(top,literal)${path}`);
  const tracked = new Set<string>();
  // 控制命令行长度，兼容 Windows；仅读取选择范围，避免整仓索引输出。
  for (const batch of pathBatches(literal)) {
    const entries = (
      await executeGit(repo, ["ls-files", "--stage", "-z", "--", ...batch])
    ).stdout.split("\0");
    for (const entry of entries) {
      if (!entry) continue;
      if (entry.startsWith("160000 "))
        throw new GitCommitError(
          "GIT_PATH_UNAVAILABLE",
          "Discard submodule changes in an external Git tool",
        );
      tracked.add(entry.slice(entry.indexOf("\t") + 1));
    }
  }
  // 校验准备阶段之后再次检查快照，避免对过期预览执行破坏性写入。
  if ((await readGitWorkingTreeStatus(repo)).snapshot !== request.expectedSnapshot)
    throw new GitCommitError(
      "GIT_STATUS_CHANGED",
      "Git changes changed; refresh before discarding",
    );
  for (const path of originals) tracked.add(path);
  for (const change of status.staged) {
    if (change.kind === "delete" && paths.has(change.path)) tracked.add(change.path);
  }
  const input = [...tracked].map((path) => `:(top,literal)${path}\0`).join("");
  if (input) {
    const hasHead = await executeGit(repo, ["rev-parse", "--verify", "--quiet", "HEAD"]).then(
      () => true,
      (error: unknown) => {
        // 只有 Git 明确报告引用不存在才按空仓库处理；进程故障不能降级成删除文件。
        if (error instanceof Error && "exitCode" in error && error.exitCode === 1) return false;
        throw error;
      },
    );
    await executeGit(
      repo,
      hasHead
        ? [
            "restore",
            "--source=HEAD",
            "--staged",
            "--worktree",
            "--pathspec-from-file=-",
            "--pathspec-file-nul",
          ]
        : ["rm", "-f", "--pathspec-from-file=-", "--pathspec-file-nul"],
      input,
    );
  }
  // clean 默认遵循 ignore 且不进入嵌套仓库；绝不使用 -x 或双 -f。
  const untracked = [...paths]
    .filter((path) => !tracked.has(path))
    .map((path) => `:(top,literal)${path}`);
  for (const batch of pathBatches(untracked))
    await executeGit(repo, ["clean", "-f", "-d", "--", ...batch]);
  return readGitWorkingTreeStatus(repo);
}

/** 按 UTF-8 字节分批，为 Windows 命令行和 Git 固定参数预留空间。 */
function* pathBatches(paths: readonly string[]): Generator<readonly string[]> {
  let batch: string[] = [];
  let bytes = 0;
  for (const path of paths) {
    const size = Buffer.byteLength(path) + 32;
    if (batch.length > 0 && bytes + size > 8192) {
      yield batch;
      batch = [];
      bytes = 0;
    }
    batch.push(path);
    bytes += size;
  }
  if (batch.length > 0) yield batch;
}
