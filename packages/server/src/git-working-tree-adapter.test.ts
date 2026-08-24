import { describe, expect, it, vi } from "vitest";

const gitCommand = vi.hoisted(() => ({
  executeGit: vi.fn((_root: string, arguments_: readonly string[]) => {
    if (arguments_[0] === "status") {
      return Promise.resolve("");
    }
    if (arguments_[0] === "branch") {
      return Promise.resolve("adapter-main\n");
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
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]);
    expect(status).toMatchObject({ branch: "adapter-main", repositoryMode: "root" });
  });
});
