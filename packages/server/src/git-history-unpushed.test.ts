import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { readProjectGitHistory } from "./git-history.js";

const exec = promisify(execFile);
const roots: string[] = [];
const git = async (root: string, ...args: string[]) =>
  (await exec("git", ["-C", root, ...args])).stdout.trim();
async function repository() {
  const root = await mkdtemp(join(tmpdir(), "codexly-history-unpushed-"));
  roots.push(root);
  await git(root, "init", "--initial-branch=main");
  await git(root, "config", "user.name", "Test");
  await git(root, "config", "user.email", "test@example.com");
  await git(root, "commit", "--allow-empty", "-m", "baseline");
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("keeps an empty repository readable before its first commit", async () => {
  const root = await mkdtemp(join(tmpdir(), "codexly-history-empty-"));
  roots.push(root);
  await git(root, "init", "--initial-branch=main");
  expect(await readProjectGitHistory(root)).toMatchObject({
    branch: "main",
    commits: [],
    nextCursor: null,
  });
});

it("marks local commits across pages and clears marks after a successful push", async () => {
  const root = await repository();
  const remote = await mkdtemp(join(tmpdir(), "codexly-history-remote-"));
  roots.push(remote);
  await git(remote, "init", "--bare");
  await git(root, "remote", "add", "origin", remote);
  await git(root, "push", "-u", "origin", "main");
  for (let index = 0; index < 22; index++)
    await git(root, "commit", "--allow-empty", "-m", `local ${String(index)}`);
  const first = await readProjectGitHistory(root);
  expect(first.nextCursor).toBe("20");
  const second = await readProjectGitHistory(root, { cursor: first.nextCursor ?? "20" });
  expect(first.commits.every((commit) => commit.unpushed === true)).toBe(true);
  expect(second.commits.map((commit) => commit.unpushed)).toEqual([true, true, false]);
  await git(root, "push", "origin", "main");
  expect(
    (await readProjectGitHistory(root)).commits.every((commit) => commit.unpushed === false),
  ).toBe(true);
});

it("compares merge ancestry with the configured push remote rather than the upstream", async () => {
  const root = await repository();
  const base = await git(root, "rev-parse", "HEAD");
  await git(root, "switch", "-c", "side");
  await git(root, "commit", "--allow-empty", "-m", "side commit");
  const side = await git(root, "rev-parse", "HEAD");
  await git(root, "switch", "main");
  await git(root, "commit", "--allow-empty", "-m", "main commit");
  await git(root, "merge", "--no-ff", "side", "-m", "merge side");
  const head = await git(root, "rev-parse", "HEAD");
  await git(root, "remote", "add", "origin", "https://example.invalid/read.git");
  await git(root, "remote", "add", "publish", "https://example.invalid/write.git");
  await git(root, "update-ref", "refs/remotes/origin/main", head);
  await git(root, "update-ref", "refs/remotes/publish/main", side);
  await git(root, "config", "branch.main.remote", "origin");
  await git(root, "config", "branch.main.merge", "refs/heads/main");
  await git(root, "config", "branch.main.pushRemote", "publish");
  const page = await readProjectGitHistory(root);
  expect(
    page.commits
      .filter((commit) => commit.unpushed)
      .map((commit) => commit.title)
      .sort(),
  ).toEqual(["main commit", "merge side"]);
  expect(page.commits.find((commit) => commit.sha === base)?.unpushed).toBe(false);
  expect(page.commits.find((commit) => commit.sha === side)?.unpushed).toBe(false);
  // 空的覆盖配置应沿用原有 Git 目标回退规则，而不是丢失可确认的历史状态。
  await git(root, "config", "branch.main.pushRemote", "");
  expect(
    (await readProjectGitHistory(root)).commits.every((commit) => commit.unpushed === false),
  ).toBe(true);
});

it("leaves marks unknown without a push target instead of calling every old commit unpushed", async () => {
  const root = await repository();
  expect((await readProjectGitHistory(root)).commits[0]?.unpushed).toBeUndefined();
  await git(root, "remote", "add", "origin", "https://example.invalid/repo.git");
  expect((await readProjectGitHistory(root)).commits[0]?.unpushed).toBeUndefined();
});
