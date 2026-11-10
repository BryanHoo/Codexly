import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PatchDiffViewer } from "@codexly/ui/agent/patch-diff-viewer";

it.each(["", "--- a/worktree/acp-routes.ts\n+++ b/worktree/acp-routes.ts\n"])(
  "空操作补丁显示无文本差异，而非预览失败：%s",
  (patch) => {
    const markup = renderToStaticMarkup(
      <PatchDiffViewer
        path="worktree/acp-routes.ts"
        patch={patch}
        emptyLabel="本次操作没有文本差异"
        unavailableLabel="无法预览"
      />,
    );
    expect(markup).toContain("本次操作没有文本差异");
    expect(markup).not.toContain("无法预览");
    expect(markup).not.toContain("diffs-container");
  },
);

it.each([
  "",
  "Binary files a/.DS_Store and b/.DS_Store differ",
  "--- /dev/null\n+++ b/image.bin\nBinary files /dev/null and b/image.bin differ",
  "diff --git a/a.bin b/a.bin\nGIT binary patch\nliteral 4\nabc",
  "--- a/a.txt\n+++ b/a.txt\n@@ invalid @@",
])("异常或二进制补丁仅显示局部提示：%s", (patch) => {
  const markup = renderToStaticMarkup(<PatchDiffViewer path="test.bin" patch={patch} />);
  expect(markup).toContain('role="status"');
  expect(markup).not.toContain("diffs-container");
});

it("正常文本补丁仍进入 Diff 渲染器", () => {
  const markup = renderToStaticMarkup(
    <PatchDiffViewer path="a.ts" patch={"--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n"} />,
  );
  expect(markup).toContain("diffs-container");
});

it("worktree 绝对路径的完整补丁仍可预览", () => {
  const path = "/project/.worktree/feat-acp/packages/server/src/routes/acp-routes.ts";
  const markup = renderToStaticMarkup(
    <PatchDiffViewer
      path={path}
      patch={`--- a/${path}\n+++ b/${path}\n@@ -163,2 +163,3 @@\n   );\n+  app.patch();\n   app.post();\n`}
      emptyLabel="本次操作没有文本差异"
      unavailableLabel="无法预览"
    />,
  );
  expect(markup).toContain("diffs-container");
  expect(markup).not.toContain("本次操作没有文本差异");
});
