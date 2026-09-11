import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { readGitWorkingTreeStatusMock, resolveProjectGitRepositoryRootMock, spawnMock } = vi.hoisted(
  () => ({
    readGitWorkingTreeStatusMock: vi.fn(),
    resolveProjectGitRepositoryRootMock: vi.fn(),
    spawnMock: vi.fn(),
  }),
);

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("./git-working-tree.js", () => ({
  readGitWorkingTreeStatus: readGitWorkingTreeStatusMock,
  resolveProjectGitRepositoryRoot: resolveProjectGitRepositoryRootMock,
}));

import { commitSelectedProjectChanges } from "./git-commit.js";
import { limitGitProcess } from "./git-concurrency.js";

function createSuccessfulChild(stdout = "") {
  const child = new EventEmitter() as EventEmitter & {
    kill: ReturnType<typeof vi.fn>;
    stderr: PassThrough;
    stdin: PassThrough;
    stdout: PassThrough;
  };
  child.kill = vi.fn();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  queueMicrotask(() => {
    if (stdout !== "") {
      child.stdout.write(stdout);
    }
    child.emit("close", 0);
  });
  return child;
}

describe("Git commit process input", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveProjectGitRepositoryRootMock.mockResolvedValue("/project");
    readGitWorkingTreeStatusMock.mockResolvedValue({
      branch: "main",
      repositoryMode: "root",
      snapshot: "snapshot",
      staged: [],
      unstaged: [{ kind: "modify", path: "selected.txt" }],
    });
    spawnMock
      .mockImplementationOnce(() => createSuccessfulChild())
      .mockImplementationOnce(() => createSuccessfulChild())
      .mockImplementationOnce(() => createSuccessfulChild())
      .mockImplementationOnce(() => createSuccessfulChild())
      .mockImplementationOnce(() => createSuccessfulChild(`${"a".repeat(40)}\n`));
  });

  it("opens stdin only for a Git command that consumes input", async () => {
    await commitSelectedProjectChanges("/project", {
      action: "commit",
      expectedSnapshot: "snapshot",
      message: "fix(git): 修复提交",
      paths: ["selected.txt"],
    });

    expect(spawnMock).toHaveBeenCalledTimes(5);
    expect(spawnMock.mock.calls[2]?.[2]).toMatchObject({ stdio: ["pipe", "pipe", "pipe"] });
    for (const commandIndex of [0, 1, 3, 4]) {
      expect(spawnMock.mock.calls[commandIndex]?.[2]).toMatchObject({
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
  });

  it("holds the shared process slot until an oversized child has closed", async () => {
    spawnMock.mockReset();
    const child = new EventEmitter() as ReturnType<typeof createSuccessfulChild>;
    child.kill = vi.fn();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    spawnMock.mockReturnValue(child);
    const occupied = Promise.withResolvers<undefined>();
    const slots = Array.from({ length: 3 }, () => limitGitProcess(() => occupied.promise));
    const commit = commitSelectedProjectChanges("/project", {
      action: "commit",
      expectedSnapshot: "snapshot",
      message: "fix(git): 校验进程限流",
      paths: ["selected.txt"],
    });
    const rejected = expect(commit).rejects.toMatchObject({ code: "GIT_COMMIT_FAILED" });
    try {
      await vi.waitFor(() => {
        expect(spawnMock).toHaveBeenCalledTimes(1);
      });
      child.stdout.write(Buffer.alloc(10 * 1024 * 1024 + 1));
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
      const next = vi.fn();
      const queued = limitGitProcess(next);
      await new Promise((resolve) => setImmediate(resolve));
      expect(next).not.toHaveBeenCalled();
      child.emit("close", 1);
      await queued;
      await rejected;
    } finally {
      child.emit("close", 1);
      occupied.resolve(undefined);
      await Promise.all(slots);
    }
  });
});
