import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import * as gitCommand from "./git-mutation-command.js";
import { discardSelectedProjectChanges } from "./git-discard.js";
import { readGitWorkingTreeStatus } from "./git-working-tree.js";
const exec = promisify(execFile);
const roots: string[] = [];
const git = (root: string, ...args: string[]) => exec("git", ["-C", root, ...args]);
async function repo() {
  const root = await mkdtemp(join(tmpdir(), "codexly-discard-"));
  roots.push(root);
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.name", "Test");
  await git(root, "config", "user.email", "test@example.com");
  for (const name of ["a.txt", "b.txt", "[x].txt"]) await writeFile(join(root, name), "original");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "initial");
  return root;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
it("discards selected staged, unstaged and new files while preserving other staged content", async () => {
  const root = await repo();
  await writeFile(join(root, "a.txt"), "staged");
  await writeFile(join(root, "b.txt"), "keep");
  await git(root, "add", ".");
  await writeFile(join(root, "a.txt"), "unstaged");
  await writeFile(join(root, "new.txt"), "new");
  const status = await readGitWorkingTreeStatus(root);
  await discardSelectedProjectChanges(root, {
    paths: ["a.txt", "new.txt"],
    expectedSnapshot: status.snapshot,
  });
  expect(await readFile(join(root, "a.txt"), "utf8")).toBe("original");
  await expect(access(join(root, "new.txt"))).rejects.toThrow();
  expect((await git(root, "show", ":b.txt")).stdout).toBe("keep");
});
it("rejects stale snapshots and paths outside the change list before touching files", async () => {
  const root = await repo();
  await writeFile(join(root, "a.txt"), "edited");
  const status = await readGitWorkingTreeStatus(root);
  await expect(
    discardSelectedProjectChanges(root, { paths: ["a.txt"], expectedSnapshot: "0".repeat(64) }),
  ).rejects.toMatchObject({ code: "GIT_STATUS_CHANGED" });
  await expect(
    discardSelectedProjectChanges(root, {
      paths: ["a.txt", "../outside"],
      expectedSnapshot: status.snapshot,
    }),
  ).rejects.toThrow();
  expect(await readFile(join(root, "a.txt"), "utf8")).toBe("edited");
});
it("handles a single literal filename and restores a selected rename", async () => {
  const root = await repo();
  await writeFile(join(root, "[x].txt"), "edited");
  let status = await readGitWorkingTreeStatus(root);
  await discardSelectedProjectChanges(root, {
    paths: ["[x].txt"],
    expectedSnapshot: status.snapshot,
  });
  expect(await readFile(join(root, "[x].txt"), "utf8")).toBe("original");
  await git(root, "mv", "a.txt", "renamed.txt");
  status = await readGitWorkingTreeStatus(root);
  await discardSelectedProjectChanges(root, {
    paths: ["renamed.txt"],
    expectedSnapshot: status.snapshot,
  });
  expect(await readFile(join(root, "a.txt"), "utf8")).toBe("original");
  await expect(access(join(root, "renamed.txt"))).rejects.toThrow();
});
it("removes staged additions and supports an unborn branch", async () => {
  const root = await repo();
  await writeFile(join(root, "added.txt"), "new");
  await git(root, "add", "added.txt");
  let status = await readGitWorkingTreeStatus(root);
  await discardSelectedProjectChanges(root, {
    paths: ["added.txt"],
    expectedSnapshot: status.snapshot,
  });
  await expect(access(join(root, "added.txt"))).rejects.toThrow();
  await git(root, "checkout", "--orphan", "empty");
  await git(root, "rm", "-rf", ".");
  await writeFile(join(root, "first.txt"), "new");
  await git(root, "add", "first.txt");
  status = await readGitWorkingTreeStatus(root);
  await discardSelectedProjectChanges(root, {
    paths: ["first.txt"],
    expectedSnapshot: status.snapshot,
  });
  await expect(access(join(root, "first.txt"))).rejects.toThrow();
});

it("restores selected staged deletions while leaving other deletions staged", async () => {
  const root = await repo();
  await git(root, "rm", "a.txt", "b.txt");
  const status = await readGitWorkingTreeStatus(root);
  await discardSelectedProjectChanges(root, {
    paths: ["a.txt"],
    expectedSnapshot: status.snapshot,
  });
  expect(await readFile(join(root, "a.txt"), "utf8")).toBe("original");
  await expect(access(join(root, "b.txt"))).rejects.toThrow();
});

it("does not treat Git process failures as an unborn branch", async () => {
  const root = await repo();
  await writeFile(join(root, "a.txt"), "keep on error");
  const status = await readGitWorkingTreeStatus(root);
  const execute = gitCommand.executeGit;
  vi.spyOn(gitCommand, "executeGit").mockImplementation((repo, args, ...rest) => {
    if (args[0] === "rev-parse" && args.includes("HEAD"))
      return Promise.reject(Object.assign(new Error("Git unavailable"), { exitCode: 128 }));
    return execute(repo, args, ...rest);
  });
  await expect(
    discardSelectedProjectChanges(root, { paths: ["a.txt"], expectedSnapshot: status.snapshot }),
  ).rejects.toThrow("Git unavailable");
  expect(await readFile(join(root, "a.txt"), "utf8")).toBe("keep on error");
});
