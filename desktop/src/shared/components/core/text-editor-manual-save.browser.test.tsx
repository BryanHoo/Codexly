import "../../styles/globals.css";
import "@codexly/ui/core/document-workspace.css";
import { useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { DocumentWorkspace } from "@codexly/ui/core/document-workspace";
import { useDocumentWorkspace } from "@codexly/ui/core/use-document-workspace";
import { useDocumentSaveGuard } from "@codexly/ui/core/document-navigation";
import { useInlineTextFile } from "@codexly/ui/core/inline-text-file";

it("切标签/失焦不写盘，圆点跨后台保留，保存及关闭确认作用于正确文件", async () => {
  const host = document.createElement("div"); host.style.cssText = "height:600px;width:700px"; document.body.append(host);
  const root = createRoot(host); const scope = {};
  const save = vi.fn(async () => ({ version: "v2" }));
  let workspace!: ReturnType<typeof useDocumentWorkspace<{ id: string }>>;
  function File({ id }: { id: string }) {
    const editor = useInlineTextFile({ enabled: true, fileKey: id, scope, read: async () => ({ path: id, content: "原文", version: "v1" }), checkRevision: async () => ({ revision: "r1" }), save, onSaved: () => undefined, notify: () => undefined });
    useDocumentSaveGuard(editor);
    return <>{editor.element}{editor.conflictElement}{editor.closeElement}</>;
  }
  function View() {
    const value = useDocumentWorkspace<{ id: string }>("manual");
    useLayoutEffect(() => { workspace = value; });
    return <DocumentWorkspace workspace={value} locale="zh-CN" describe={(doc) => ({ title: doc.id, detail: doc.id, kind: "source" })} renderDocument={(doc) => <File id={doc.id} />}><button type="button">聊天</button></DocumentWorkspace>;
  }
  const dirty = (id: string) => host.querySelector(`[data-document-tab-id="${id}"] [data-document-dirty]`);
  // 工具栏现在也有文字“保存”；关闭确认必须明确点击当前弹窗内的动作。
  const click = async (text: string) => userEvent.click([...(document.querySelector('[role="dialog"]') ?? document).querySelectorAll("button")].find((node) => node.textContent === text)!);
  try {
    flushSync(() => root.render(<View />));
    flushSync(() => { void workspace.open({ id: "a.txt" }); });
    await expect.poll(() => host.querySelector(".cm-content"), { timeout: 10000 }).not.toBeNull();
    await userEvent.click(page.getByRole("textbox", { name: /\.txt$/ })); await userEvent.keyboard("{End}草稿");
    window.dispatchEvent(new Event("blur")); document.dispatchEvent(new Event("visibilitychange"));
    await expect.poll(() => dirty("a.txt")).not.toBeNull(); expect(save).not.toHaveBeenCalled();
    flushSync(() => { void workspace.open({ id: "b.txt" }); });
    await expect.poll(() => host.querySelector('.cm-content[aria-label="b.txt"]')).not.toBeNull();
    expect(dirty("a.txt")).not.toBeNull(); expect(save).not.toHaveBeenCalled();
    flushSync(() => { void workspace.select("a.txt"); });
    await expect.poll(() => host.querySelector(".cm-content")?.textContent).toBe("原文草稿");
    await userEvent.click(page.getByRole("textbox", { name: /\.txt$/ }));
    const modifier = navigator.platform.includes("Mac") ? "Meta" : "Control";
    await userEvent.keyboard(`{${modifier}>}s{/${modifier}}`);
    await expect.poll(() => dirty("a.txt")).toBeNull(); expect(save).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{End}未保存");
    flushSync(() => { void workspace.select("b.txt"); });
    await expect.poll(() => host.querySelector('.cm-content[aria-label="b.txt"]')).not.toBeNull();
    flushSync(() => { void workspace.close("a.txt"); });
    await expect.poll(() => document.querySelector('[role="dialog"]')).not.toBeNull();
    await click("取消"); expect(workspace.documents).toHaveLength(2); expect(save).toHaveBeenCalledTimes(1);
    flushSync(() => { void workspace.close("a.txt"); }); await click("不保存");
    await expect.poll(() => workspace.documents.map((doc) => doc.id)).toEqual(["b.txt"]);
    expect(save).toHaveBeenCalledTimes(1);
    await userEvent.click(page.getByRole("textbox", { name: "b.txt", exact: true }));
    await userEvent.keyboard("{End}保存并关闭");
    // 后台文件保存冲突时定位该标签并自动弹出恢复选项，不能只在隐藏会话里报错。
    flushSync(() => { void workspace.open({ id: "a.txt" }); });
    await expect.poll(() => host.querySelector('.cm-content[aria-label="a.txt"]')).not.toBeNull();
    save.mockRejectedValueOnce({ code: "TEXT_FILE_CONFLICT" });
    flushSync(() => { void workspace.close("b.txt"); });
    await click("保存");
    await expect.poll(() => workspace.activeId).toBe("b.txt");
    await expect.poll(() => document.querySelector('[role="dialog"]')?.textContent).toContain("保存冲突");
    await click("继续编辑");
    expect(dirty("b.txt")).not.toBeNull();
    expect(workspace.documents).toHaveLength(2);
    flushSync(() => { void workspace.close("b.txt"); });
    await click("保存");
    await expect.poll(() => workspace.documents.map((doc) => doc.id)).toEqual(["a.txt"]);
    expect(save).toHaveBeenCalledTimes(3);
    flushSync(() => { void workspace.close("a.txt"); });
    await expect.poll(() => workspace.documents).toEqual([]);
  } finally { flushSync(() => root.unmount()); host.remove(); }
});
