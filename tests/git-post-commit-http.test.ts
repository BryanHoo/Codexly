import { CodexlyClient } from "@codexly/client";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
import { createCodexlyServer } from "@codexly/server";
import {
  createProvider,
  createServerOptions,
  project,
} from "../packages/server/src/app-all.test-support.js";
import { pushProjectCommits } from "../packages/server/src/git-commit.js";

const executeFile = promisify(execFile);
async function git(root: string, ...args: string[]) {
  return executeFile("git", ["-C", root, ...args], { encoding: "utf8" });
}

it("refreshes overlapping snapshots after an HTTP commit and pushes the new HEAD", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "codexly-http-post-commit-"));
  const root = join(temporaryRoot, "repository");
  const remote = join(temporaryRoot, "remote.git");
  let releaseInspection!: () => void;
  const inspectionGate = new Promise<void>((resolve) => {
    releaseInspection = resolve;
  });
  const options = createServerOptions(createProvider().provider);
  const registeredProject = { ...project, roots: [{ id: "test-root", path: root }] };
  let holdNextInspection = false;
  let inspectionStarted = false;
  const app = await createCodexlyServer({
    ...options,
    projectRepository: {
      ...options.projectRepository,
      read: (projectId) =>
        Promise.resolve(projectId === project.id ? registeredProject : undefined),
    },
    // 只控制请求重叠的时机，Git 提交、读取、推送和 HTTP 客户端全部使用真实实现。
    pushProjectCommits: async (rootPath, request) => {
      if (request.action === "inspect" && holdNextInspection) {
        holdNextInspection = false;
        inspectionStarted = true;
        await inspectionGate;
      }
      return pushProjectCommits(rootPath, request);
    },
  });
  try {
    await executeFile("git", ["init", "--initial-branch=main", root]);
    await executeFile("git", ["init", "--bare", remote]);
    await git(root, "config", "user.name", "Codexly Test");
    await git(root, "config", "user.email", "codexly@example.com");
    await writeFile(join(root, "change.txt"), "before\n");
    await git(root, "add", "--all");
    await git(root, "commit", "-m", "chore(test): 初始化仓库");
    await git(root, "remote", "add", "origin", remote);
    await git(root, "push", "--set-upstream", "origin", "main");
    const baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
    const client = new CodexlyClient({ baseUrl });
    await writeFile(join(root, "change.txt"), "after\n");
    const before = await client.getProjectGitStatus(project.id, { rootPath: root });
    const committed = await client.commitProjectChanges(project.id, root, {
      action: "commit",
      expectedSnapshot: before.snapshot,
      message: "fix(git): 验证提交后的并发刷新",
      paths: ["change.txt"],
    });
    expect(committed.status.snapshot).not.toBe(before.snapshot);
    holdNextInspection = true;
    const earlierRefresh = client.pushProjectCommits(project.id, root, {
      action: "inspect",
      expectedSnapshot: before.snapshot,
    });
    let refreshed;
    try {
      await vi.waitFor(() => {
        expect(inspectionStarted).toBe(true);
      });
      refreshed = await client.pushProjectCommits(project.id, root, {
        action: "inspect",
        expectedSnapshot: committed.status.snapshot,
      });
    } finally {
      releaseInspection();
      const earlier = await earlierRefresh;
      expect(earlier.remoteState?.head).toBe(committed.commitSha);
    }
    expect(refreshed.remoteState).toMatchObject({ head: committed.commitSha, ahead: 1 });
    const pushed = await client.pushProjectCommits(project.id, root, {
      action: "push",
      expectedSnapshot: committed.status.snapshot,
      expectedHead: committed.commitSha,
      expectedBranch: "main",
    });
    expect(pushed.pushStatus).toBe("pushed");
    expect((await git(remote, "rev-parse", "main")).stdout.trim()).toBe(committed.commitSha);
  } finally {
    releaseInspection();
    await app.close();
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}, 15_000);
