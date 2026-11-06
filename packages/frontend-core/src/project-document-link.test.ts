import { describe, expect, it } from "vitest";
import { resolveProjectDocumentLink } from "./project-document-link.js";

describe("文件内部链接解析", () => {
  it.each([
    ["guide.md", "/repo/docs/readme.md", "/repo/docs/guide.md"],
    ["../assets/a%20b.png", "/repo/docs/readme.md", "/repo/assets/a b.png"],
    ["/__codexly_relative__/./guide.md", "/repo/docs/readme.md", "/repo/docs/guide.md"],
    ["/repo/LICENSE", "/repo/docs/readme.md", "/repo/LICENSE"],
    ["file:///repo/a%23b.txt", "/repo/docs/readme.md", "/repo/a#b.txt"],
    ["../guide.md", "C:\\repo\\docs\\readme.md", "C:/repo/guide.md"],
    ["guide.md", "//host/share/docs/readme.md", "//host/share/docs/guide.md"],
    ["./a\\b.md", "/repo/readme.md", "/repo/a\\b.md"],
  ])("将 %s 按宿主文件 %s 解析", (href, source, path) => {
    expect(resolveProjectDocumentLink(href, source)).toMatchObject({ path, lineNumber: null });
  });
  it("保留行号定位并剥离 URL 后缀", () => {
    expect(resolveProjectDocumentLink("guide.ts?raw=1#L12", "/repo/readme.md")).toEqual({
      path: "/repo/guide.ts",
      lineNumber: 12,
    });
  });
  it.each([
    "https://example.com/a",
    "mailto:a@example.com",
    "javascript:alert(1)",
    "#标题",
    "//example.com/a",
    "data:text/plain,a",
  ])("保留非文件链接 %s", (href) => {
    expect(resolveProjectDocumentLink(href, "/repo/readme.md")).toBeNull();
  });
});
