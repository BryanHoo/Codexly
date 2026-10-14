import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { operateGitRemote } from "./git-remote.js";

const exec = promisify(execFile);
const roots: string[] = [];
const git = async (root: string, ...args: string[]) =>
  (await exec("git", ["-C", root, ...args])).stdout.trim();
async function repo(bare = false) {
  const root = await mkdtemp(join(tmpdir(), "codexly-remote-"));
  roots.push(root);
  await git(root, "init", ...(bare ? ["--bare"] : ["--initial-branch=main"]));
  if (!bare) {
    await git(root, "config", "user.name", "Test");
    await git(root, "config", "user.email", "test@example.com");
    await writeFile(join(root, "a.txt"), "initial\n");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "test(git): 初始化");
  }
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

it("inspects without changing the repository and publishes an explicitly chosen branch", async () => {
  const root = await repo();
  const remote = await repo(true);
  await git(root, "remote", "add", "origin", remote);
  const before = await git(root, "rev-parse", "HEAD");
  const inspected = await operateGitRemote(root, { action: "inspect" });
  expect(inspected.remoteState?.upstream).toBeNull();
  expect(inspected.remoteState?.remotes[0]?.name).toBe("origin");
  const published = await operateGitRemote(root, { action: "publish", remote: "origin" });
  expect(published.pushStatus).toBe("pushed");
  expect(published.remoteState?.ahead).toBe(0);
  expect(await git(root, "rev-parse", "--abbrev-ref", "@{upstream}")).toBe("origin/main");
  expect(await git(root, "rev-parse", "HEAD")).toBe(before);
});

it("fetches remote updates, refuses integration with working edits and integrates a clean tree", async () => {
  const root = await repo();
  const remote = await repo(true);
  const other = await repo();
  await git(root, "remote", "add", "origin", remote);
  await operateGitRemote(root, { action: "publish", remote: "origin" });
  await git(other, "remote", "add", "origin", remote);
  await git(other, "fetch", "origin");
  await git(other, "reset", "--hard", "origin/main");
  await writeFile(join(other, "a.txt"), "remote update\n");
  await git(other, "commit", "-am", "test(git): 更新远端");
  await git(other, "push", "origin", "main");
  const fetched = await operateGitRemote(root, { action: "fetch" });
  expect(fetched.remoteState?.behind).toBe(1);
  await writeFile(join(root, "a.txt"), "working edit\n");
  expect((await operateGitRemote(root, { action: "integrate" })).pushStatus).toBe("failed");
  expect(await git(root, "show", "HEAD:a.txt")).toBe("initial");
  await git(root, "restore", "a.txt");
  expect((await operateGitRemote(root, { action: "integrate" })).remoteState?.behind).toBe(0);
  expect(await git(root, "show", "HEAD:a.txt")).toBe("remote update");
});

it("refuses option-like remote names and configures a remote without pushing", async () => {
  const root = await repo();
  expect(
    (
      await operateGitRemote(root, {
        action: "configure",
        remote: "--upload-pack=bad",
        url: "https://example.com/repo.git",
      })
    ).pushStatus,
  ).toBe("failed");
  expect(
    (
      await operateGitRemote(root, {
        action: "configure",
        remote: "origin",
        url: "https://example.com/repo.git",
      })
    ).remoteState?.remotes[0]?.name,
  ).toBe("origin");
});

it("moves existing commits to a feature branch before publishing a protected-branch workaround", async () => {
  const root = await repo();
  const head = await git(root, "rev-parse", "HEAD");
  const created = await operateGitRemote(root, {
    action: "branch",
    branchName: "feature/recovery",
  });
  expect(created.pushStatus).toBe("updated");
  expect(created.branch).toBe("feature/recovery");
  expect(await git(root, "rev-parse", "HEAD")).toBe(head);
});

it("refuses divergent integration without creating conflicts or changing the local commit", async () => {
  const root = await repo();
  const remote = await repo(true);
  const other = await repo();
  await git(root, "remote", "add", "origin", remote);
  await operateGitRemote(root, { action: "publish", remote: "origin" });
  await git(other, "remote", "add", "origin", remote);
  await git(other, "fetch", "origin");
  await git(other, "reset", "--hard", "origin/main");
  await writeFile(join(other, "a.txt"), "remote\n");
  await git(other, "commit", "-am", "test(git): 修改远端");
  await git(other, "push", "origin", "main");
  await writeFile(join(root, "a.txt"), "local\n");
  await git(root, "commit", "-am", "test(git): 修改本地");
  const before = await git(root, "rev-parse", "HEAD");
  const refused = await operateGitRemote(root, { action: "integrate" });
  expect(refused.pushStatus).toBe("failed");
  expect(refused.remoteState?.operation).toBe("none");
  expect(refused.remoteState?.conflicts).toEqual([]);
  expect(await git(root, "rev-parse", "HEAD")).toBe(before);
  expect(await git(root, "status", "--porcelain")).toBe("");
});

it.each(["resolve", "continue", "abort"])(
  "rejects the removed %s operation without changing the repository",
  async (action) => {
    const root = await repo();
    const before = await git(root, "rev-parse", "HEAD");
    const refused = await operateGitRemote(root, { action });
    expect(refused.pushStatus).toBe("failed");
    expect(refused.pushError).toContain("Unsupported Git remote action");
    expect(await git(root, "rev-parse", "HEAD")).toBe(before);
  },
);
