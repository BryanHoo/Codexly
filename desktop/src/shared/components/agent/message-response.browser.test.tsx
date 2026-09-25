import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { i18n } from "../../../i18n/i18n.js";
import { MessageResponse } from "./message-response.js";
import { AppendOnlyTextBuffer } from "../../lib/append-only-text.js";

describe("MessageResponse file reference menu", () => {
  it("previews oversized complex blocks and fully parses the same snapshot when streaming ends", async () => {
    const buffer = new AppendOnlyTextBuffer("Stable paragraph\n\n- **first**\n");
    const screen = await render(<MessageResponse textSource={buffer.getSnapshot()} mode="streaming" isAnimating />);
    const stable = screen.container.querySelector("p");
    buffer.append("- **next** list item\n".repeat(1_000));
    const snapshot = buffer.getSnapshot();
    await screen.rerender(<MessageResponse textSource={snapshot} mode="streaming" isAnimating />);
    expect(screen.container.querySelector("p")).toBe(stable);
    expect(screen.container.querySelector("[data-streaming-markdown-preview]")?.textContent).toContain("**next** list item");
    buffer.append("- **latest**");
    const finalSnapshot = buffer.getSnapshot();
    const firstPage = screen.container.querySelector("[data-streaming-markdown-preview] > span");
    await screen.rerender(<MessageResponse textSource={finalSnapshot} mode="streaming" isAnimating />);
    expect(screen.container.querySelector("[data-streaming-markdown-preview] > span")).toBe(firstPage);
    expect(screen.container.textContent).toContain("**latest**");
    await screen.rerender(<MessageResponse textSource={finalSnapshot} mode="streaming" isAnimating={false} />);
    expect(screen.container.querySelector("[data-streaming-markdown-preview]")).toBeNull();
    expect(screen.container.querySelectorAll("li")).toHaveLength(1_002);
    expect(screen.container.querySelector('li:last-child [data-streamdown="strong"]')?.textContent).toBe("latest");
  });

  it("keeps stable paragraphs mounted across block page boundaries", async () => {
    const paragraph = vi.fn(({ children }: { children?: React.ReactNode }) => <p>{children}</p>);
    const components = { p: paragraph };
    const buffer = new AppendOnlyTextBuffer(Array.from({ length: 64 }, (_, i) => `Paragraph ${i}\n\n`).join(""));
    const screen = await render(<MessageResponse components={components} textSource={buffer.getSnapshot()} mode="streaming" />);
    const first = screen.container.querySelector("p");
    paragraph.mockClear();
    buffer.append("New paragraph\n\n");
    await screen.rerender(<MessageResponse components={components} textSource={buffer.getSnapshot()} mode="streaming" />);
    expect(screen.container.querySelector("p")).toBe(first);
    expect(paragraph.mock.calls.length).toBeLessThanOrEqual(3);
    await expect.element(screen.getByText("New paragraph")).toBeVisible();
  });

  it("appends plain text pages and restores Markdown when syntax arrives", async () => {
    const buffer = new AppendOnlyTextBuffer("ordinary text ".repeat(400));
    const screen = await render(<MessageResponse textSource={buffer.getSnapshot()} mode="streaming" />);
    const firstPage = screen.container.querySelector("p > span");
    buffer.append("latest words");
    await screen.rerender(<MessageResponse textSource={buffer.getSnapshot()} mode="streaming" />);
    expect(screen.container.querySelector("p > span")).toBe(firstPage);
    expect(screen.container.textContent).toContain("latest words");
    buffer.append(" **formatted**");
    await screen.rerender(<MessageResponse textSource={buffer.getSnapshot()} mode="streaming" />);
    expect(screen.container.querySelector('[data-streamdown="strong"]')?.textContent).toBe("formatted");
  });

  it("streams code lines without remounting history and reconciles a closing fence", async () => {
    const buffer = new AppendOnlyTextBuffer("```ts\n" + "const value = `template`;\n".repeat(64));
    const screen = await render(<MessageResponse textSource={buffer.getSnapshot()} mode="streaming" />);
    const firstLine = screen.container.querySelector("[data-streaming-code-line]");
    expect(firstLine).not.toBeNull();
    buffer.append("const last = 2;\n");
    await screen.rerender(<MessageResponse textSource={buffer.getSnapshot()} mode="streaming" />);
    expect(screen.container.querySelector("[data-streaming-code-line]")).toBe(firstLine);
    expect(screen.container.querySelector("code")?.textContent).toContain("const last = 2;");
    buffer.append("```\n\nDone");
    await screen.rerender(<MessageResponse textSource={buffer.getSnapshot()} mode="streaming" />);
    await expect.element(screen.getByText("Done")).toBeVisible();
    expect(screen.container.querySelector("[data-streaming-code-line]")).toBeNull();
  });

  it("copies the latest incremental code and preserves whole-document options", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    try {
      const buffer = new AppendOnlyTextBuffer("```ts\nconst first = 1;");
      const screen = await render(<MessageResponse textSource={buffer.getSnapshot()} mode="streaming" />);
      buffer.append("\nconst second = 2;");
      await screen.rerender(<MessageResponse textSource={buffer.getSnapshot()} mode="streaming" />);
      await screen.getByRole("button", { name: "Copy code" }).click();
      expect(writeText).toHaveBeenCalledWith("const first = 1;\nconst second = 2;");
      const rtl = new AppendOnlyTextBuffer("שלום");
      await screen.rerender(<MessageResponse textSource={rtl.getSnapshot()} mode="streaming" dir="auto" />);
      expect(screen.container.querySelector('[dir="rtl"]')).not.toBeNull();
    } finally {
      writeText.mockRestore();
    }
  });

  it("renders chunk updates and authoritative replacements", async () => {
    const buffer = new AppendOnlyTextBuffer("First paragraph\n\n");
    const screen = await render(<MessageResponse textSource={buffer.getSnapshot()} mode="streaming" />);
    await expect.element(screen.getByText("First paragraph")).toBeVisible();
    buffer.append("[main.ts](/workspace/src/main.ts:12)");
    await screen.rerender(<MessageResponse textSource={buffer.getSnapshot()} mode="streaming" />);
    expect(screen.container.querySelectorAll("[data-file-reference]")).toHaveLength(1);
    await expect.element(screen.getByText("First paragraph")).toBeVisible();
    const replacement = new AppendOnlyTextBuffer("Final answer");
    await screen.rerender(<MessageResponse textSource={replacement.getSnapshot()} mode="static" />);
    await expect.element(screen.getByText("Final answer")).toBeVisible();
    expect(screen.container.querySelectorAll("[data-file-reference]")).toHaveLength(0);
    expect(screen.container.textContent).not.toContain("First paragraph");
  });

  it("opens the containing folder from a streaming file reference", async () => {
    const onOpenFileReference = vi.fn();
    const screen = await render(
      <MessageResponse mode="streaming" onOpenFileReference={onOpenFileReference}>
        {"[main.ts](/workspace/src/main.ts:12)"}
      </MessageResponse>,
    );
    const reference = screen.container.querySelector<HTMLElement>("[data-file-reference]");
    expect(reference).not.toBeNull();
    reference?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));

    const action = screen.getByText(
      i18n.t("openMenu.openContainingFolder", { ns: "workbench" }),
    );
    await expect.element(action).toBeVisible();
    await action.click();

    expect(onOpenFileReference).toHaveBeenCalledWith(
      { lineNumber: 12, path: "/workspace/src/main.ts" },
      "containing-folder",
    );
  });

  it("copies the absolute path from a file reference", async () => {
    const onOpenFileReference = vi.fn();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    try {
      const screen = await render(
        <MessageResponse mode="streaming" onOpenFileReference={onOpenFileReference}>
          {"[main.ts](C:\\workspace\\src\\main.ts:12)"}
        </MessageResponse>,
      );
      screen.container
        .querySelector<HTMLElement>("[data-file-reference]")
        ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));

      const action = screen.getByText(i18n.t("openMenu.copyAbsolutePath", { ns: "workbench" }));
      await expect.element(action).toBeVisible();
      await action.click();

      expect(writeText).toHaveBeenCalledWith("C:/workspace/src/main.ts");
      expect(onOpenFileReference).not.toHaveBeenCalled();
    } finally {
      writeText.mockRestore();
    }
  });
});
