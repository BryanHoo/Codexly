import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { TextEditorNotice, type TextEditorNoticeKind } from "@codexly/ui/core/text-editor-notice";
import {
  textFileEditorChinese,
  textFileEditorEnglish,
} from "@codexly/frontend-core/text-file-editor";

function render(kind: TextEditorNoticeKind | null, labels = textFileEditorChinese) {
  return renderToStaticMarkup(
    <TextEditorNotice
      kind={kind}
      labels={labels}
      onRetryEdit={() => undefined}
      onRetrySave={() => undefined}
      onDismiss={() => undefined}
    />,
  );
}

it("explains capacity protection persistently and offers an editing retry", () => {
  const html = render("capacity");
  expect(html).toContain('role="status"');
  expect(html).toContain("保护");
  expect(html).toContain("未保存");
  expect(html).toContain("只读");
  expect(html).toContain("重试编辑");
  expect(html).toContain("查看和复制");
});

it("explains rejected input and confirms the user can still edit", () => {
  const html = render("input-limit");
  expect(html).toContain('role="alert"');
  expect(html).toContain("2 MiB");
  expect(html).toContain("继续编辑");
  expect(html).toContain("减少");
  expect(html).toContain("知道了");
});

it.each(["error", "conflict"] as const)(
  "offers save retry and preserves the draft for %s",
  (kind) => {
    const html = render(kind);
    expect(html).toContain("保留");
    expect(html).toContain("重试保存");
  },
);

it("describes unsupported files and failed loading with a way to retry", () => {
  expect(render("unsupported")).toContain("只读");
  expect(render("load-error")).toContain("重试编辑");
});

it("clarifies that parsing degradation still permits editing and saving", () => {
  const html = render("plain-text");
  expect(html).toContain("语法高亮");
  expect(html).toContain("编辑和保存");
  expect(html).not.toContain("<button");
  expect(render(null)).toBe("");
});

it("provides the same reason and recovery actions in English", () => {
  const html = render("capacity", textFileEditorEnglish);
  expect(html).toContain("read-only");
  expect(html).toContain("Retry editing");
});
