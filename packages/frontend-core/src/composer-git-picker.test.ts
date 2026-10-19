import { describe, expect, it } from "vitest";
import { buildComposerGitPicker, formatComposerWorkspacePath } from "./composer-git-picker.js";

const worktrees = [
  { branch: "main", current: false, path: "/repo" },
  { branch: "feat/search", current: true, path: "/repo/.worktree/search" },
  { branch: null, current: false, path: "/external/review" },
];

describe("Composer Git picker", () => {
  it("将当前工作树置顶，保留主目录身份与 detached HEAD", () => {
    const model = buildComposerGitPicker(
      ["main", "feat/search", "release"],
      "feat/search",
      worktrees,
      "/repo/.worktree/search",
      "",
    );
    expect(model.worktrees.map((item) => [item.path, item.selected, item.main])).toEqual([
      ["/repo/.worktree/search", true, false],
      ["/repo", false, true],
      ["/external/review", false, false],
    ]);
    expect(model.worktrees[2]?.branch).toBeNull();
    expect(model.branches.find((item) => item.name === "main")?.occupiedPath).toBe("/repo");
    expect(model.branches.find((item) => item.name === "feat/search")).toMatchObject({
      selected: true,
      occupiedPath: undefined,
    });
    expect(model.branches.find((item) => item.name === "release")?.occupiedPath).toBeUndefined();
  });

  it("按分支或完整路径筛选，不区分大小写，空格不影响匹配", () => {
    expect(
      buildComposerGitPicker(
        ["main", "feat/search"],
        "main",
        worktrees,
        "/repo",
        " SEARCH ",
      ).worktrees.map((item) => item.branch),
    ).toEqual(["feat/search"]);
    expect(
      buildComposerGitPicker(["main"], "main", worktrees, "/repo", "external").worktrees.map(
        (item) => item.path,
      ),
    ).toEqual(["/external/review"]);
    expect(
      buildComposerGitPicker(["main"], "main", worktrees, "/repo", "missing").branches,
    ).toEqual([]);
  });

  it("路径展示保留目录边界与跨平台语义，外部工作树保留完整路径", () => {
    expect(formatComposerWorkspacePath("/repo/.worktree/search", "/repo")).toBe(".worktree/search");
    expect(formatComposerWorkspacePath("/repo-other/topic", "/repo")).toBe("/repo-other/topic");
    expect(formatComposerWorkspacePath("C:\\repo\\.worktree\\topic", "C:\\repo\\")).toBe(
      ".worktree/topic",
    );
    expect(formatComposerWorkspacePath("/repo", "/repo")).toBe("repo");
    expect(formatComposerWorkspacePath("/repo", undefined)).toBe("/repo");
  });
});
