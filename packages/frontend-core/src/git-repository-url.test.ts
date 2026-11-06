import { describe, expect, it } from "vitest";
import { getGitRepositoryWebUrl, selectGitRepositoryWebUrl } from "./git-repository-url.js";

describe("getGitRepositoryWebUrl", () => {
  it.each([
    ["https://github.com/team/repo.git", "https://github.com/team/repo"],
    ["git@github.com:team/repo.git", "https://github.com/team/repo"],
    ["ssh://git@git.example.com:2222/team/repo.git", "https://git.example.com/team/repo"],
    ["git://example.com/team/repo.git", "https://example.com/team/repo"],
    ["https://user:secret@example.com:8443/team/repo.git", "https://example.com:8443/team/repo"],
    ["http://example.com/team/repo.git/", "http://example.com/team/repo"],
  ])("转换 %s 为浏览地址", (remote, expected) => {
    expect(getGitRepositoryWebUrl(remote)).toBe(expected);
  });
  it.each([
    "/tmp/repo.git",
    "C:\\repo.git",
    "file:///repo",
    "javascript:alert(1)",
    "",
    "../repo",
    "https://example.com/",
  ])("拒绝不可浏览的地址 %s", (remote) => {
    expect(getGitRepositoryWebUrl(remote)).toBeNull();
  });
  it("优先当前远端，其次 origin，最后首个远端", () => {
    const remotes = [
      { name: "upstream", url: "git@example.com:team/upstream.git" },
      { name: "origin", url: "git@example.com:team/origin.git" },
    ];
    expect(selectGitRepositoryWebUrl({ remote: "upstream", remotes })).toBe(
      "https://example.com/team/upstream",
    );
    expect(selectGitRepositoryWebUrl({ remote: null, remotes })).toBe(
      "https://example.com/team/origin",
    );
    expect(selectGitRepositoryWebUrl({ remote: null, remotes: remotes.slice(0, 1) })).toBe(
      "https://example.com/team/upstream",
    );
    expect(selectGitRepositoryWebUrl(undefined)).toBeNull();
  });
});
