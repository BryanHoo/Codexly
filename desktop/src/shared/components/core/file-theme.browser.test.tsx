import "../../styles/globals.css";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { TextEditorAutosave, TextFileEditor } from "@codexly/ui/core/text-file-editor";
import { TooltipProvider } from "@codexly/ui/core/tooltip";

function contrast(foreground: string, background: string) {
  const luminance = (color: string) => {
    const channels = color.match(/[\d.]+/gu)!.slice(0, 3).map((channel) => {
      const value = Number(channel) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

it("暗色正文降低反差，次级文字在不同表面仍保持 AA 可读性", () => {
  const previous = document.documentElement.dataset["theme"];
  document.documentElement.dataset["theme"] = "dark";
  const probe = document.createElement("div");
  document.body.append(probe);
  try {
    for (const surface of ["content", "sidebar", "raised", "dialog"]) {
      probe.style.background = `var(--ui-color-${surface})`;
      for (const role of ["text", "text-muted", "text-subtle"]) {
        probe.style.color = `var(--ui-color-${role})`;
        const style = getComputedStyle(probe);
        expect(contrast(style.color, style.backgroundColor)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(style.color, style.backgroundColor)).toBeLessThan(12);
      }
    }
  } finally {
    probe.remove();
    if (previous === undefined) delete document.documentElement.dataset["theme"];
    else document.documentElement.dataset["theme"] = previous;
  }
});

it("GitHub 文件主题覆盖编辑、预览与搜索，明暗切换保留草稿及撤销历史", async () => {
  const previous = document.documentElement.dataset["theme"];
  const host = document.createElement("div");
  host.style.cssText = "height:520px;width:320px";
  document.body.append(host);
  const root = createRoot(host);
  const session = new TextEditorAutosave(
    { path: "example.ts", content: '// comment\nconst message = "hello";\n', version: "v1" },
    async () => ({ version: "v2" }), () => undefined, () => undefined,
  );
  try {
    document.documentElement.dataset["theme"] = "light";
    flushSync(() => root.render(<TooltipProvider><TextFileEditor session={session} /></TooltipProvider>));
    const editor = host.querySelector<HTMLElement>(".cm-editor")!;
    const content = host.querySelector<HTMLElement>(".cm-content")!;
    await userEvent.click(content);
    await userEvent.keyboard("{ControlOrMeta>}{End}{/ControlOrMeta} edited");
    const draft = session.state.sliceDoc();
    const selection = session.state.selection;
    // 记录真实视图节点，避免主题切换依靠重建编辑器而丢失草稿、选择或撤销历史。
    for (const [theme, background, foreground, keyword] of [
      ["light", "rgb(255, 255, 255)", "rgb(36, 41, 46)", "rgb(215, 58, 73)"],
      ["dark", "rgb(34, 39, 46)", "rgb(173, 186, 199)", "rgb(244, 112, 103)"],
      ["light", "rgb(255, 255, 255)", "rgb(36, 41, 46)", "rgb(215, 58, 73)"],
    ] as const) {
      document.documentElement.dataset["theme"] = theme;
      await expect.poll(() => getComputedStyle(editor).backgroundColor).toBe(background);
      expect(getComputedStyle(editor).color).toBe(foreground);
      await expect.poll(() => [...content.querySelectorAll("span")].find((node) => node.textContent === "const")?.textContent).toBe("const");
      const token = [...content.querySelectorAll("span")].find((node) => node.textContent === "const")!;
      expect(getComputedStyle(token).color).toBe(keyword);
      expect(host.querySelector(".cm-content")).toBe(content);
      expect(session.state.sliceDoc()).toBe(draft);
      expect(session.state.selection).toBe(selection);
      expect(host.scrollWidth).toBeLessThanOrEqual(320);
    }
    await userEvent.click(host.querySelector<HTMLButtonElement>('button[aria-label="撤销"]')!);
    expect(session.state.sliceDoc()).not.toBe(draft);
    await userEvent.click(host.querySelector<HTMLButtonElement>('button[aria-label="查找与替换"]')!);
    await expect.poll(() => host.querySelector('input[name="search"]')).not.toBeNull();
    document.documentElement.dataset["theme"] = "dark";
    expect(getComputedStyle(host.querySelector(".cm-file-search")!).backgroundColor).toBe("rgb(34, 39, 46)");
    const preview = document.createElement("article");
    preview.className = "file-theme file-markdown";
    preview.innerHTML = '<h1>文件预览</h1><p>正文 <code data-streamdown="inline-code">hello</code></p>';
    host.append(preview);
    expect(getComputedStyle(preview).backgroundColor).toBe("rgb(34, 39, 46)");
    expect(getComputedStyle(preview).color).toBe("rgb(173, 186, 199)");
    expect(getComputedStyle(preview.querySelector("code")!).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  } finally {
    flushSync(() => root.unmount());
    host.remove();
    if (previous === undefined) delete document.documentElement.dataset["theme"];
    else document.documentElement.dataset["theme"] = previous;
  }
});
