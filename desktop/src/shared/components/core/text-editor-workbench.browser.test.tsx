import { useLayoutEffect } from "react";
import "../../styles/globals.css";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { TextEditorAutosave, TextFileEditor } from "@codexly/ui/core/text-file-editor";

it("提供查找替换、撤销、换行和状态；内部操作不触发失焦保存", async () => {
  const host = document.createElement("div");
  host.style.cssText = "height:500px;width:360px";
  document.body.append(host);
  const root = createRoot(host);
  const save = vi.fn(async () => ({ version: "v2" }));
  const session = new TextEditorAutosave({ path: "notes.txt", content: "hello world\nhello", version: "v1" }, save, () => undefined, () => undefined);
  const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  try {
    flushSync(() => root.render(<TextFileEditor session={session} />));
    expect(button("查找与替换")).not.toBeNull();
    const content = host.querySelector<HTMLElement>(".cm-content")!;
    await userEvent.click(content);
    await userEvent.keyboard("{End}!");
    expect(host.textContent).toContain("未保存");
    await userEvent.click(button("查找与替换"));
    expect(save).not.toHaveBeenCalled();
    // 首次查找异步挂载界面，完成后再验证布局和替换行为。
    await expect.poll(() => host.querySelectorAll(".cm-file-search-row")).toHaveLength(2);
    const closeSearch = host.querySelector<HTMLButtonElement>('button[name="close"]')!;
    expect(closeSearch.getBoundingClientRect().width).toBeGreaterThanOrEqual(32);
    expect(closeSearch.getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
    const search = host.querySelector<HTMLInputElement>('input[name="search"]')!;
    const replacement = host.querySelector<HTMLInputElement>('input[name="replace"]')!;
    expect(replacement.getBoundingClientRect().top).toBeGreaterThanOrEqual(search.getBoundingClientRect().bottom);
    await userEvent.fill(search, "hello");
    await userEvent.fill(host.querySelector<HTMLInputElement>('input[name="replace"]')!, "你好");
    await userEvent.click([...host.querySelectorAll("button")].find((node) => node.textContent === "全部替换")!);
    expect(session.state.sliceDoc()).toContain("你好 world");
    expect(save).not.toHaveBeenCalled();
    await userEvent.click(button("撤销"));
    expect(session.state.sliceDoc()).toContain("hello world");
    await userEvent.click(button("自动换行"));
    expect(host.querySelector(".cm-lineWrapping")).not.toBeNull();
    await userEvent.click(button("保存"));
    await expect.poll(() => host.textContent).toContain("已保存");
    expect(save).toHaveBeenCalledTimes(1);
    expect(host.scrollWidth).toBeLessThanOrEqual(360);
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
});

it("冲突比较只在打开时读取，取消保留草稿，确认磁盘版本后恢复编辑", async () => {
  const { useInlineTextFile } = await import("@codexly/ui/core/inline-text-file");
  const { TextEditorNotice } = await import("@codexly/ui/core/text-editor-notice");
  const { textFileEditorChinese } = await import("@codexly/frontend-core/text-file-editor");
  const { getTextEditorLabels } = await import("@codexly/ui/core/text-editor-labels");
  const labels = getTextEditorLabels(textFileEditorChinese);
  const host = document.createElement("div");
  host.style.cssText = "height:500px;width:360px";
  document.body.append(host);
  const root = createRoot(host);
  const scope = {};
  const read = vi.fn().mockResolvedValueOnce({ path: "conflict.txt", content: "原文", version: "v1" }).mockResolvedValue({ path: "conflict.txt", content: "磁盘更新", version: "v2" });
  const save = vi.fn().mockRejectedValue({ code: "TEXT_FILE_CONFLICT" });
  let editor!: ReturnType<typeof useInlineTextFile>;
  function View() {
    const value = useInlineTextFile({ enabled: true, fileKey: "conflict.txt", scope, read, save, checkRevision: async () => ({ revision: "r1" }), onSaved: () => undefined, notify: () => undefined });
    useLayoutEffect(() => { editor = value; });
    return <><TextEditorNotice kind={value.noticeKind} labels={labels} onRetryEdit={value.retryEdit} onRetrySave={value.retrySave} onDismiss={value.dismissNotice} onCompare={value.compareWithDisk} />{value.element}{value.conflictElement}</>;
  }
  const button = (label: string) => [...document.querySelectorAll("button")].find((item) => item.textContent === label)!;
  try {
    flushSync(() => root.render(<View />));
    await expect.poll(() => host.querySelector(".cm-content")).not.toBeNull();
    await userEvent.click(host.querySelector<HTMLElement>(".cm-content")!);
    await userEvent.keyboard("{End}草稿");
    expect(read).toHaveBeenCalledTimes(1);
    await editor.flush();
    // 保存冲突自动打开比较和恢复弹窗，无需点击常驻提示。
    await expect.poll(() => document.querySelector('[data-text-editor-comparison] .cm-editor')).not.toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
    expect(editor.getContent()).toBe("原文草稿");
    await userEvent.click(button(labels.reloadDisk));
    expect(document.body.textContent).toContain(labels.confirmReload);
    await userEvent.click(button(labels.cancel));
    expect(editor.getContent()).toBe("原文草稿");
    await userEvent.click(button(labels.reloadDisk));
    await userEvent.click(button(labels.confirm));
    await expect.poll(() => editor.getContent()).toBe("磁盘更新");
    expect(editor.hasUnsavedChanges()).toBe(false);
    expect(host.textContent).toContain("磁盘更新");
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
});
