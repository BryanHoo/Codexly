import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PatchDiffViewer } from "@codexly/ui/agent/patch-diff-viewer";
import { normalizeFileChangePatch } from "@codexly/frontend-core/file-change-patch";
import { parsePatchFiles } from "@pierre/diffs";

it.each(["/Users/example/project with spaces/中文.ts", "C:/Users/example/project/file.ts"])(
  "ACP 绝对路径 Git 文件头能渲染实际增删内容（%s）",
  (path) => {
    const patch = `diff --git ${path} ${path}\n--- ${path}\n+++ ${path}\n@@ -5,2 +5,2 @@\n context\n-oldValue\n+newValue\n`;
    const normalized = normalizeFileChangePatch({ diff: patch, kind: "update", path });
    const file = parsePatchFiles(normalized, undefined, true)[0]?.files[0];
    expect(file?.additionLines.join("")).toContain("newValue");
    expect(file?.deletionLines.join("")).toContain("oldValue");
    expect(renderToStaticMarkup(<PatchDiffViewer path={path} patch={patch} />)).toContain(
      "diffs-container",
    );
  },
);

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

it.each([
  "@@ -42 +42 @@\n-old\n+new\n",
  "--- a/a.ts\n+++ b/a.ts\n@@\n-old\n+new\n@@ function example()\n-previous\n+next\n*** End of File\n",
])("历史和流式补丁缺少标准头部时仍可预览", (patch) => {
  const markup = renderToStaticMarkup(<PatchDiffViewer path="a.ts" patch={patch} />);
  expect(markup).toContain("diffs-container");
});
