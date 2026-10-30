import { useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { TextEditorAutosave, TextFileEditor } from "@codexly/ui/core/text-file-editor";
import { useInlineTextFile } from "@codexly/ui/core/inline-text-file";
import { TextEditorNotice } from "@codexly/ui/core/text-editor-notice";
import { textFileEditorChinese } from "@codexly/frontend-core/text-file-editor";
import { DocumentNavigationContext, useDocumentSaveGuard } from "@codexly/ui/core/document-navigation";
import type { DocumentLeaveGuard } from "@codexly/ui/core/document-navigation";

it.each([
  { content: "原文\n", pasted: "第一行\r\n第二行\r\n", expected: "第一行\n第二行\n原文\n" },
  { content: "原文\r\n", pasted: "第一行\n第二行\n", expected: "第一行\r\n第二行\r\n原文\r\n" },
])("粘贴不同平台的换行后仍可按原格式保存 $content", async ({ content, pasted, expected }) => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const save = vi.fn(async () => ({ version: "v2" }));
  const session = new TextEditorAutosave({ path: "notes.md", content, version: "v1" }, save, () => undefined, () => undefined);
  try {
    flushSync(() => root.render(<TextFileEditor session={session} />));
    const editable = host.querySelector<HTMLElement>(".cm-content")!;
    await userEvent.click(editable);
    await userEvent.keyboard("{Home}");
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", pasted);
    // 真实 paste 处理链必须在进入 CodeMirror 文本树前统一换行，不能把混合换行发给服务端。
    editable.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
    expect(session.state.sliceDoc()).toBe(expected);
    expect(await session.flush()).toBe(true);
    expect(save).toHaveBeenCalledWith({ path: "notes.md", content: expected, expectedVersion: "v1" });
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
});

it("保存失败后先确认放弃，再恢复编辑视图并解除双端共用的关闭保护", async () => {
  const host = document.createElement("div");
  host.style.height = "500px";
  document.body.append(host);
  const root = createRoot(host);
  const scope = {};
  const guard: { current: DocumentLeaveGuard | null } = { current: null };
  const save = vi.fn().mockRejectedValue(new Error("cannot save"));
  const read = vi.fn(async () => ({ path: "notes.md", content: "原文\r\n", version: "v1" }));
  let editor!: ReturnType<typeof useInlineTextFile>;
  function View() {
    const value = useInlineTextFile({
      enabled: true, scope, fileKey: "notes.md", read,
      checkRevision: async () => ({ revision: "revision" }),
      save, onSaved: () => undefined, notify: () => undefined,
    });
    useDocumentSaveGuard(value);
    useLayoutEffect(() => { editor = value; });
    return <>
      <TextEditorNotice kind={value.noticeKind} labels={textFileEditorChinese}
        onRetryEdit={value.retryEdit} onRetrySave={value.retrySave}
        onDismiss={value.dismissNotice} onDiscard={value.discardChanges} busy={value.saving} />
      {value.element}
    </>;
  }
  const button = (label: string) => [...host.querySelectorAll("button")].find((item) => item.textContent === label)!;
  try {
    flushSync(() => root.render(<DocumentNavigationContext value={guard}><View /></DocumentNavigationContext>));
    await expect.poll(() => host.querySelector(".cm-editor"), { timeout: 10_000 }).not.toBeNull();
    const content = host.querySelector<HTMLElement>(".cm-content")!;
    await userEvent.click(content);
    await userEvent.keyboard("{Home}草稿");
    await expect.poll(() => editor.getContent()).toBe("草稿原文\r\n");
    expect(await editor.flush()).toBe(false);
    await expect.poll(() => button("放弃修改")).toBeDefined();
    await userEvent.click(button("放弃修改"));
    expect(editor.getContent()).toBe("草稿原文\r\n");
    expect(host.textContent).toContain("无法撤销");
    await userEvent.click(button("继续编辑"));
    expect(editor.hasUnsavedChanges()).toBe(true);
    await userEvent.click(button("放弃修改"));
    await userEvent.click(button("确认放弃"));
    expect(editor.getContent()).toBe("原文\r\n");
    expect(content.textContent).toBe("原文");
    await userEvent.click(content);
    const modifier = navigator.platform.includes("Mac") ? "Meta" : "Control";
    await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`);
    expect(editor.getContent()).toBe("原文\r\n");
    expect(await guard.current!()).toBe(true);
    expect(editor.hasUnsavedChanges()).toBe(false);
    const failedSaves = save.mock.calls.length;
    expect(failedSaves).toBeGreaterThanOrEqual(1);
    // 重建后继续输入和保存仍走同一会话，不能只恢复显示却丢失视图绑定。
    save.mockResolvedValue({ version: "v2" });
    await userEvent.keyboard("{Home}继续");
    expect(editor.hasUnsavedChanges()).toBe(true);
    expect(await editor.flush()).toBe(true);
    expect(save).toHaveBeenLastCalledWith({ path: "notes.md", content: "继续原文\r\n", expectedVersion: "v1" });
    expect(save).toHaveBeenCalledTimes(failedSaves + 1);
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
});
