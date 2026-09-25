import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import type { TaskWindowPacket } from "../../protocol/task-window.js";
import { I18nextProvider, i18n } from "../../i18n/i18n.js";
import { TaskWindow } from "./task-window.js";

const native = vi.hoisted(() => ({
  connectTaskWindow: vi.fn(), acknowledgeTaskWindow: vi.fn().mockResolvedValue(undefined),
  restoreTaskWindow: vi.fn().mockResolvedValue(undefined), closeTaskWindow: vi.fn().mockResolvedValue(undefined),
  dragTaskWindow: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../platform/tauri/task-window-client.js", () => native);
import "../../shared/styles/globals.css";

afterEach(() => vi.clearAllMocks());

describe("TaskWindow", () => {
  it("preserves expanded stream content and reading position after completion", async () => {
    await page.viewport(440, 220);
    let receive!: (packet: TaskWindowPacket) => void;
    native.connectTaskWindow.mockImplementation(async (callback: typeof receive) => { receive = callback; return () => undefined; });
    await render(<I18nextProvider i18n={i18n}><TaskWindow /></I18nextProvider>);
    await vi.waitFor(() => expect(receive).toBeTypeOf("function"));
    const text = Array.from({ length: 60 }, (_, index) => `执行过程 ${index}`).join("\n\n");
    receive({ sequence: 1, title: "完成测试", status: "running", order: ["a"], updates: [{ id: "a", kind: "message", text, append: false }], truncated: false });
    const viewport = document.querySelector<HTMLDivElement>(".task-window-output")!;
    await vi.waitFor(() => expect(viewport.scrollHeight).toBeGreaterThan(500));
    await expect.element(page.getByText("执行过程 59", { exact: true })).toBeVisible();
    const bottomContent = viewport.textContent;
    viewport.scrollTop = 280;
    viewport.dispatchEvent(new Event("scroll"));
    await expect.poll(() => viewport.textContent).not.toBe(bottomContent);
    const before = viewport.textContent;
    const height = viewport.scrollHeight;
    receive({ sequence: 2, title: "完成测试", status: "completed", order: ["a"], updates: [], truncated: false });
    await vi.waitFor(() => expect(native.acknowledgeTaskWindow).toHaveBeenCalledWith(2));
    expect(viewport.textContent).toBe(before);
    expect(viewport.scrollHeight).toBe(height);
    expect(viewport.scrollTop).toBe(280);
    expect(document.querySelector("details, [aria-expanded=false]")).toBeNull();
  });
  it("renders compact Markdown and operation titles without executable content", async () => {
    await page.viewport(440, 280);
    await i18n.changeLanguage("zh-CN");
    const updates = [
      { id: "a", kind: "message", text: "### 核对结果\n\n**类型检查**通过，使用 `pnpm check`。\n\n![image](https://example.com/tracker.png)<script>alert(1)</script>", append: false },
      { id: "b", kind: "command", text: "pnpm check", append: false },
      { id: "c", kind: "file_change", text: "src/main.tsx", append: false },
    ];
    native.connectTaskWindow.mockImplementation(async (receive: (packet: TaskWindowPacket) => void) => {
      receive({ sequence: 1, title: "阅读并理解项目", status: "running", order: updates.map((row) => row.id), updates, truncated: false });
      return () => undefined;
    });
    const screen = await render(<I18nextProvider i18n={i18n}><TaskWindow /></I18nextProvider>);
    await expect.element(screen.getByRole("heading", { name: "核对结果" })).toBeVisible();
    expect(document.querySelector(".task-window-output strong")?.textContent).toBe("类型检查");
    expect(document.querySelector(".task-window-output img, .task-window-output script")).toBeNull();
    expect(getComputedStyle(document.querySelector(".task-window")!).fontSize).toBe("12px");
    await expect.element(screen.getByText("终端", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("文件", { exact: true })).toBeVisible();
  });

  it("unmounts offscreen blocks and keeps the newest stream visible after appends and resize", async () => {
    await page.viewport(440, 280);
    let receive!: (packet: TaskWindowPacket) => void;
    native.connectTaskWindow.mockImplementation(async (callback: typeof receive) => { receive = callback; return () => undefined; });
    const screen = await render(<I18nextProvider i18n={i18n}><TaskWindow /></I18nextProvider>);
    await vi.waitFor(() => expect(receive).toBeTypeOf("function"));
    receive({ sequence: 1, title: "长输出", status: "running", order: ["a"], updates: [{ id: "a", kind: "message", text: Array.from({ length: 100 }, (_, index) => `段落 ${index}`).join("\n\n"), append: false }], truncated: false });
    await expect.element(screen.getByText("段落 99", { exact: true })).toBeVisible();
    expect(document.querySelector(".task-window-output")?.textContent).not.toContain("段落 0");
    expect(document.querySelectorAll("[data-task-output-block]").length).toBeLessThan(20);
    receive({ sequence: 2, title: "长输出", status: "running", order: ["a"], updates: [{ id: "a", kind: "message", text: "\n\n**最新输出**", append: true }], truncated: false });
    await expect.element(screen.getByText("最新输出", { exact: true })).toBeVisible();
    await page.viewport(360, 220);
    await expect.element(screen.getByText("最新输出", { exact: true })).toBeVisible();
    const viewport = document.querySelector(".task-window-output")!;
    await vi.waitFor(() => expect(viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight).toBeLessThan(2));
  });

  it("renders a read-only stream and restores the main window on double click", async () => {
    await i18n.changeLanguage("zh-CN");
    native.connectTaskWindow.mockImplementation(async (receive: (packet: TaskWindowPacket) => void) => {
      receive({ sequence: 1, title: "任务 A", status: "running", order: ["a"], updates: [{ id: "a", kind: "message", text: "正在输出", append: false }], truncated: false });
      return () => undefined;
    });
    const screen = await render(<I18nextProvider i18n={i18n}><TaskWindow /></I18nextProvider>);
    await expect.element(screen.getByText("正在输出", { exact: true })).toBeVisible();
    expect(document.querySelector("textarea, input, [contenteditable=true]")).toBeNull();
    await screen.getByText("正在输出", { exact: true }).dblClick();
    await vi.waitFor(() => expect(native.restoreTaskWindow).toHaveBeenCalledTimes(1));
    expect(native.closeTaskWindow).not.toHaveBeenCalled();
  });

  it("keeps the reading position while scrolled up and resumes following at the bottom", async () => {
    await page.viewport(440, 220);
    let receive!: (packet: TaskWindowPacket) => void;
    native.connectTaskWindow.mockImplementation(async (callback: typeof receive) => { receive = callback; return () => undefined; });
    const screen = await render(<I18nextProvider i18n={i18n}><TaskWindow /></I18nextProvider>);
    await vi.waitFor(() => expect(receive).toBeTypeOf("function"));
    receive({ sequence: 1, title: "滚动任务", status: "running", order: ["a"], updates: [{ id: "a", kind: "message", text: Array.from({ length: 80 }, (_, index) => `内容 ${index}`).join("\n\n"), append: false }], truncated: false });
    await expect.element(screen.getByText("内容 79", { exact: true })).toBeVisible();
    const viewport = document.querySelector<HTMLDivElement>(".task-window-output")!;
    expect(getComputedStyle(viewport).overflowY).toBe("auto");
    viewport.scrollTop = 560;
    viewport.dispatchEvent(new Event("scroll"));
    await vi.waitFor(() => expect(viewport.textContent).not.toContain("内容 79"));
    const position = viewport.scrollTop;
    receive({ sequence: 2, title: "滚动任务", status: "running", order: ["a"], updates: [{ id: "a", kind: "message", text: "\n\n新输出", append: true }], truncated: false });
    await vi.waitFor(() => expect(native.acknowledgeTaskWindow).toHaveBeenCalledWith(2));
    await page.viewport(440, 180);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(Math.abs(viewport.scrollTop - position)).toBeLessThan(2);
    expect(document.querySelectorAll("[data-task-output-block]").length).toBeLessThan(20);
    viewport.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
    document.querySelector("main")!.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, buttons: 1, clientX: 30, pointerId: 1 }));
    expect(native.dragTaskWindow).not.toHaveBeenCalled();
    viewport.scrollTop = viewport.scrollHeight;
    viewport.dispatchEvent(new Event("scroll"));
    await expect.element(screen.getByText("新输出", { exact: true })).toBeVisible();
    receive({ sequence: 3, title: "滚动任务", status: "running", order: ["a"], updates: [{ id: "a", kind: "message", text: "\n\n继续跟随", append: true }], truncated: false });
    await expect.element(screen.getByText("继续跟随", { exact: true })).toBeVisible();
  });

  it("keeps the window usable when restoring fails", async () => {
    native.restoreTaskWindow.mockRejectedValueOnce(new Error("failed"));
    const screen = await render(<I18nextProvider i18n={i18n}><TaskWindow /></I18nextProvider>);
    await screen.getByRole("button", { name: "返回主窗口" }).click();
    await expect.element(screen.getByRole("alert")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "返回主窗口" })).toBeEnabled();
  });
});
