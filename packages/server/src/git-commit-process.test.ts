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
      .mockImplementationOnce(() => createSuccessfulChild(`${"a".repeat(40)}\n`));
  });

  it("opens stdin only for a Git command that consumes input", async () => {
    await commitSelectedProjectChanges("/project", {
      action: "commit",
      expectedSnapshot: "snapshot",
      message: "fix(git): 修复提交",
      paths: ["selected.txt"],
    });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock.mock.calls[0]?.[2]).toMatchObject({ stdio: ["pipe", "pipe", "pipe"] });
    expect(spawnMock.mock.calls[1]?.[2]).toMatchObject({ stdio: ["ignore", "pipe", "pipe"] });
  });
});
