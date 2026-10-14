import { access } from "node:fs/promises";
import { resolve } from "node:path";
import type { GitRemoteState, PushProjectCommitsResponse } from "@codexly/protocol";
import { executeGit } from "./git-mutation-command.js";
import { invalidateGitBranchCache } from "./git-working-tree.js";

type RemoteOperation = Readonly<{
  action?: string;
  remote?: string;
  url?: string;
  paths?: readonly string[];
  branchName?: string;
  expectedHead?: string;
  expectedBranch?: string;
}>;
const text = async (root: string, args: readonly string[]) =>
  (await executeGit(root, args)).stdout.trim();
const optional = async (root: string, args: readonly string[]) => {
  try {
    return (await text(root, args)) || null;
  } catch {
    return null;
  }
};
const config = (root: string, name: string) => optional(root, ["config", "--get", name]);
const redact = (value: string) => value.replace(/(https?:\/\/)[^/@\s]+@/giu, "$1***@");

/** 仅检查本地远端配置和已获取的引用；检查状态不隐式访问网络。 */
export async function readGitRemoteState(root: string): Promise<GitRemoteState> {
  const [branch, head, names, upstream, mergePath, conflictText] = await Promise.all([
    optional(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    optional(root, ["rev-parse", "--verify", "HEAD"]),
    text(root, ["remote"]),
    optional(root, ["rev-parse", "--abbrev-ref", "@{upstream}"]),
    text(root, ["rev-parse", "--git-path", "MERGE_HEAD"]),
    executeGit(root, ["diff", "--name-only", "--diff-filter=U", "-z"]).then(
      (result) => result.stdout,
    ),
  ]);
  const remotes = await Promise.all(
    names
      .split("\n")
      .filter(Boolean)
      .slice(0, 64)
      .map(async (name) => ({
        name,
        url: redact(await text(root, ["remote", "get-url", "--push", name])),
      })),
  );
  const remote = branch
    ? ((await config(root, `branch.${branch}.pushRemote`)) ??
      (await config(root, "remote.pushDefault")) ??
      (await config(root, `branch.${branch}.remote`)) ??
      (remotes.length === 1 ? (remotes[0]?.name ?? null) : null))
    : null;
  const pushDefault = await config(root, "push.default");
  const targetBranch =
    branch && pushDefault === "upstream"
      ? ((await config(root, `branch.${branch}.merge`))?.replace(/^refs\/heads\//u, "") ?? branch)
      : branch;
  const tracking = remote && targetBranch ? `refs/remotes/${remote}/${targetBranch}` : null;
  const counts =
    head && tracking
      ? await optional(root, ["rev-list", "--left-right", "--count", `HEAD...${tracking}`])
      : null;
  const [ahead, behind] = counts?.split(/\s+/u).map(Number) ?? [null, null];
  let merging = false;
  try {
    await access(resolve(root, mergePath));
    merging = true;
  } catch {
    /* 没有正在进行的合并。 */
  }
  return {
    head,
    upstream,
    remote,
    targetBranch,
    remotes,
    ahead: ahead ?? null,
    behind: behind ?? null,
    checkedAt: new Date().toISOString(),
    operation: merging ? "merge" : "none",
    conflicts: conflictText.split("\0").filter(Boolean),
  };
}

/** 远端操作由用户显式选择；保留工作区和索引，不自动 stash、强推或重写历史。 */
export async function operateGitRemote(
  root: string,
  request: RemoteOperation,
): Promise<PushProjectCommitsResponse> {
  const branch = await optional(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const before = await readGitRemoteState(root);
  const remote = request.remote ?? before.remote;
  let pushStatus: PushProjectCommitsResponse["pushStatus"] = "checked";
  let pushError: string | null = null;
  try {
    if (
      request.expectedHead &&
      (before.head !== request.expectedHead || branch !== request.expectedBranch)
    )
      throw new Error("Git HEAD or branch changed; check the remote status and retry");
    if (remote !== null && (!/^[A-Za-z0-9_.-]+$/u.test(remote) || remote.startsWith("-")))
      throw new Error("Invalid remote name");
    const action = request.action ?? "push";
    if (action === "configure") {
      const url = request.url;
      if (!remote || !url || url.startsWith("-") || /[\0\r\n]/u.test(url) || url.length > 4096)
        throw new Error("Invalid remote URL or name");
      await executeGit(root, [
        "remote",
        before.remotes.some((item) => item.name === remote) ? "set-url" : "add",
        remote,
        url,
      ]);
      pushStatus = "updated";
    } else if (action === "branch") {
      const name = request.branchName;
      if (!name || name.startsWith("-") || name.length > 1024)
        throw new Error("Choose a valid feature branch name");
      await executeGit(root, ["check-ref-format", "--branch", name]);
      await executeGit(root, ["switch", "-c", name]);
      pushStatus = "updated";
    } else if (action === "inspect") {
      // 检查状态只读取本地引用，UI 标明最近检查时间。
    } else if (action === "abort") {
      if (before.operation !== "merge") throw new Error("No merge is in progress");
      await executeGit(root, ["merge", "--abort"]);
      pushStatus = "updated";
    } else if (action === "continue") {
      if (before.operation !== "merge" || before.conflicts.length)
        throw new Error("Resolve and stage all merge conflicts first");
      await executeGit(root, ["-c", "core.editor=true", "commit", "--no-edit"]);
      pushStatus = "updated";
    } else if (action === "resolve") {
      const paths = request.paths;
      if (
        before.operation !== "merge" ||
        !paths?.length ||
        paths.some((path) => !before.conflicts.includes(path))
      )
        throw new Error("Choose a current merge conflict to mark resolved");
      // 用户显式标记后仅暂存这些冲突文件；diff 检查阻止将残留冲突标记写进合并提交。
      const literalPaths = paths.map((path) => `:(literal)${path}`);
      await executeGit(root, ["diff", "--check", "--", ...literalPaths]);
      await executeGit(root, ["add", "--", ...literalPaths]);
      pushStatus = "updated";
    } else {
      if (!branch || !before.head) throw new Error("Create a branch and commit before publishing");
      if (!remote || !before.remotes.some((item) => item.name === remote))
        throw new Error("No remote configured; choose a remote first");
      if (action === "publish") {
        await executeGit(root, [
          "push",
          "--set-upstream",
          "--",
          remote,
          `${request.expectedHead ?? "HEAD"}:refs/heads/${branch}`,
        ]);
        if (request.expectedHead)
          await executeGit(root, ["branch", `--set-upstream-to=${remote}/${branch}`, "--", branch]);
        pushStatus = "pushed";
      } else if (action === "push") {
        if (before.operation !== "none")
          throw new Error("Complete or cancel the merge before pushing");
        if (!before.upstream) {
          pushStatus = "not_configured";
          throw new Error("Branch not published; publish it to a remote first");
        }
        await executeGit(root, [
          "push",
          "--",
          remote,
          `${request.expectedHead ?? "HEAD"}:refs/heads/${before.targetBranch ?? branch}`,
        ]);
        pushStatus = "pushed";
      } else if (action === "fetch") {
        await executeGit(root, ["fetch", "--", remote]);
        pushStatus = "updated";
      } else if (action === "integrate") {
        if (before.operation !== "none")
          throw new Error("Complete or cancel the existing merge first");
        if (await text(root, ["status", "--porcelain", "--untracked-files=normal"]))
          throw new Error("Commit or set aside working changes before integrating remote updates");
        if (!before.upstream) throw new Error("Publish or configure a tracking branch first");
        await executeGit(root, ["fetch", "--", remote]);
        await executeGit(root, [
          "-c",
          "core.editor=true",
          "merge",
          "--no-edit",
          `refs/remotes/${remote}/${before.targetBranch ?? branch}`,
        ]);
        pushStatus = "updated";
      } else throw new Error("Unsupported Git remote action");
    }
  } catch (cause) {
    if (pushStatus !== "not_configured") pushStatus = "failed";
    pushError = redact(cause instanceof Error ? cause.message : String(cause));
  }
  if (request.action !== "inspect") invalidateGitBranchCache(root);
  return {
    branch: await optional(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    pushStatus,
    pushError,
    remoteState: await readGitRemoteState(root),
  };
}
