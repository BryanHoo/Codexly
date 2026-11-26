import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
import { startAcpLocalTask } from "./task-creation.js";

const git = promisify(execFile);
it("ACP 创建接受已登记工作树，拒绝任意子目录和其他仓库", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "acp-worktree-")));
  const root = join(directory, "root"),
    worktree = join(directory, "worktree");
  await mkdir(root);
  try {
    await git("git", ["init", root]);
    await git("git", [
      "-C",
      root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "init",
    ]);
    await git("git", ["-C", root, "worktree", "add", "-b", "test", worktree]);
    const scope = {
      id: "project",
      kind: "project" as const,
      rootPath: root,
      runtimeWorkspaceRoots: [root],
    };
    const catalog = vi.fn((_operation: unknown, payload: unknown) => Promise.resolve(payload));
    const store = { catalog } as unknown as Parameters<typeof startAcpLocalTask>[3];
    const task = await startAcpLocalTask(
      "codex",
      scope,
      { workspacePath: worktree },
      store,
      new Map(),
    );
    expect(task.workspacePath).toBe(worktree);
    expect(catalog).toHaveBeenCalledOnce();
    const child = join(worktree, "child"),
      other = join(directory, "other");
    await mkdir(child);
    await git("git", ["init", other]);
    for (const workspacePath of [child, other]) {
      await expect(
        startAcpLocalTask("codex", scope, { workspacePath }, store, new Map()),
      ).rejects.toMatchObject({ name: "AgentTurnNotSubmittedError" });
    }
    expect(catalog).toHaveBeenCalledOnce();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
