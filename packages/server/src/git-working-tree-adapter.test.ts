import { describe, expect, it, vi } from "vitest";

const gitCommand = vi.hoisted(() => ({
  executeGit: vi.fn((_root: string, arguments_: readonly string[]) => {
    if (arguments_[0] === "status") {
      return Promise.resolve("# branch.oid (initial)\0# branch.head adapter-main\0");
    }
    if (arguments_[0] === "for-each-ref") {
      return Promise.resolve(
        arguments_.includes("refs/remotes")
          ? "adapter-main\norigin/adapter-main\n"
          : "adapter-main\n",
      );
    }
    if (arguments_[0] === "symbolic-ref") {
      return Promise.resolve("refs/remotes/origin/adapter-main\n");
    }
    throw new Error(`Unexpected Git command: ${arguments_.join(" ")}`);
  }),
}));

vi.mock("./git-command.js", () => gitCommand);

import { readGitWorkingTreeStatus } from "./git-working-tree.js";

describe("readGitWorkingTreeStatus Git Adapter", () => {
  it("uses the shared Git command adapter for the default execution boundary", async () => {
    const status = await readGitWorkingTreeStatus(process.cwd());

    expect(gitCommand.executeGit).toHaveBeenCalledWith(process.cwd(), [
      "status",
      "--porcelain=v2",
      "--branch",
      "--no-ahead-behind",
      "-z",
      "--untracked-files=all",
      "--ignore-submodules=none",
    ]);
    expect(gitCommand.executeGit.mock.calls.map(([, args]) => args[0])).toEqual([
      "status",
      "for-each-ref",
      "for-each-ref",
      "symbolic-ref",
    ]);
    expect(status).toMatchObject({ branch: "adapter-main", repositoryMode: "root" });
  });
});
