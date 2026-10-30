import "../../styles/globals.css";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { TextEditorAutosave, TextFileEditor } from "@codexly/ui/core/text-file-editor";
import { TooltipProvider } from "@codexly/ui/core/tooltip";
import { textFileEditorEnglish } from "@codexly/frontend-core/text-file-editor";

it("保存文字按钮始终居右，搜索在窄容器仍保留输入宽度并提供真正的提示", async () => {
  const host = document.createElement("div");
  host.style.cssText = "height:500px;width:360px";
  document.body.append(host);
  const root = createRoot(host);
  const save = vi.fn(async () => ({ version: "v2" }));
  const session = new TextEditorAutosave(
    { path: "notes.txt", content: "hello world\nhello", version: "v1" },
    save, () => undefined, () => undefined,
  );
  const button = (name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
  try {
    flushSync(() => root.render(<TooltipProvider><TextFileEditor session={session} /></TooltipProvider>));
    const saveButton = button("保存");
    expect(saveButton.textContent).toBe("保存");
    expect(saveButton.getBoundingClientRect().left).toBeGreaterThan(button("自动换行").getBoundingClientRect().right);
    await userEvent.click(button("查找与替换"));
    // 首次查找按需加载；等待真实输入挂载后再测量布局与执行替换。
    await expect.poll(() => host.querySelector('input[name="search"]')).not.toBeNull();
    const search = host.querySelector<HTMLInputElement>('input[name="search"]')!;
    const replacement = host.querySelector<HTMLInputElement>('input[name="replace"]')!;
    expect(search.getBoundingClientRect().width).toBeGreaterThanOrEqual(140);
    expect(replacement.getBoundingClientRect().width).toBeGreaterThanOrEqual(140);
    const close = host.querySelector<HTMLButtonElement>('button[name="close"]')!;
    expect(close.querySelector("svg")).not.toBeNull();
    expect(close.getBoundingClientRect().width).toBe(32);
    await userEvent.hover(button("正则表达式"));
    await expect.poll(() => document.querySelector('[role="tooltip"]')?.textContent).toContain("正则表达式");
    await userEvent.click(button("正则表达式"));
    await userEvent.fill(search, "[");
    expect(search.getAttribute("aria-invalid")).toBe("true");
    expect(button("全部替换").disabled).toBe(true);
    await userEvent.click(button("正则表达式"));
    await userEvent.fill(search, "hello");
    await userEvent.fill(replacement, "你好");
    await userEvent.click(button("全部替换"));
    expect(session.state.sliceDoc()).toBe("你好 world\n你好");
    expect(save).not.toHaveBeenCalled();
    // Escape 关闭面板并归还正文焦点；重新打开后同步官方查询状态。
    await userEvent.click(search);
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => host.querySelector('[role="search"]')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector(".cm-content"));
    await userEvent.click(button("查找与替换"));
    await expect.poll(() => host.querySelector<HTMLInputElement>('input[name="search"]')?.value).toBe("hello");
    await userEvent.click(host.querySelector<HTMLButtonElement>('button[name="close"]')!);
    expect(document.activeElement).toBe(host.querySelector(".cm-content"));
    await userEvent.click(button("保存"));
    await expect.poll(() => save).toHaveBeenCalledTimes(1);
    for (const width of [320, 680]) {
      host.style.width = `${width}px`;
      await userEvent.click(button("查找与替换"));
      await expect.poll(() => host.querySelector('input[name="search"]')).not.toBeNull();
      expect(host.scrollWidth).toBeLessThanOrEqual(width);
      expect(host.querySelector<HTMLInputElement>('input[name="search"]')!.getBoundingClientRect().width).toBeGreaterThanOrEqual(120);
      await userEvent.click(host.querySelector<HTMLButtonElement>('button[name="close"]')!);
    }
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
});

it("旧版 WebView 在英文窄面板使用尺寸回退并在关闭后清理", async () => {
  const supports = CSS.supports.bind(CSS);
  const supportSpy = vi.spyOn(CSS, "supports").mockImplementation((property: string, value?: string) =>
    property === "container-type" ? false : value === undefined ? supports(property) : supports(property, value),
  );
  const host = document.createElement("div");
  host.style.cssText = "height:500px;width:320px";
  document.body.append(host);
  const root = createRoot(host);
  const session = new TextEditorAutosave(
    { path: "notes.txt", content: "hello", version: "v1" },
    async () => ({ version: "v2" }), () => undefined, () => undefined,
  );
  try {
    flushSync(() => root.render(<TooltipProvider><TextFileEditor session={session} labels={textFileEditorEnglish} /></TooltipProvider>));
    await userEvent.click(host.querySelector<HTMLButtonElement>('button[aria-label="Find and replace"]')!);
    await expect.poll(() => host.querySelector('input[name="search"]')).not.toBeNull();
    await expect.poll(() => host.querySelector('[data-compact]')).not.toBeNull();
    expect(host.scrollWidth).toBeLessThanOrEqual(320);
    const panel = host.querySelector<HTMLElement>('[role="search"]')!;
    const actions = host.querySelector<HTMLButtonElement>('button[name="select"]')!.getBoundingClientRect();
    expect(actions.right).toBeLessThanOrEqual(panel.getBoundingClientRect().right);
    await userEvent.click(host.querySelector<HTMLButtonElement>('button[name="close"]')!);
    expect(host.querySelector('[role="search"]')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector(".cm-content"));
  } finally {
    supportSpy.mockRestore();
    flushSync(() => root.unmount());
    host.remove();
  }
});
