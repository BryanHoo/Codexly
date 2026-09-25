import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { StrictMode } from "react";
import { page } from "vitest/browser";
import { i18n } from "../../i18n/i18n.js";
import { TooltipProvider } from "../../shared/components/core/tooltip.js";
import { TerminalWorkbench } from "./components/terminal-workbench.js";
import { TerminalFooter } from "./components/terminal-context.js";
import { TerminalStatusTrigger } from "./components/terminal-status-trigger.js";
import { terminalStore } from "./terminal-store.js";
import { removeTerminalMetadata, upsertTerminal } from "./terminal-sessions.js";
import { terminalRuntime } from "./terminal-runtime.js";
import "../../shared/styles/globals.css";

vi.mock("./terminal-runtime.js", () => ({ terminalRuntime: {
  create: vi.fn(async (projectId: string, rootId: string) => upsertTerminal(terminalStore, { projectId, rootId, terminalId: "browser-terminal", generation: "g", title: "zsh", state: "running", cols: 80, rows: 24, exitCode: null })),
  attach: vi.fn(), detach: vi.fn(), focus: vi.fn(), close: vi.fn(async (scope) => removeTerminalMetadata(terminalStore, scope)), remove: vi.fn(),
} }));

describe("project terminal panel", () => {
  it("hides the terminal panel when switching tasks without closing the session", async () => {
    await i18n.changeLanguage("zh-CN");
    const workbench = (taskId: string) => <TooltipProvider><div style={{ height: 700, width: 1000, display: "flex" }}>
      <TerminalWorkbench enabled projectId="task-switch-project" rootId="r" taskId={taskId} label="工作区">
        <div style={{ flex: 1, minHeight: 0 }}>CodeAgent</div>
        <TerminalFooter><TerminalStatusTrigger /></TerminalFooter>
      </TerminalWorkbench>
    </div></TooltipProvider>;
    const screen = await render(workbench("task-a"));
    await screen.getByRole("button", { name: "终端 0", exact: true }).click();
    await expect.element(screen.getByRole("region", { name: "项目终端" })).toBeVisible();

    await screen.rerender(workbench("task-b"));

    await expect.element(screen.getByRole("region", { name: "项目终端" })).not.toBeInTheDocument();
    expect(terminalStore.liveCount("task-switch-project")).toBe(1);
  });

  it("deduplicates StrictMode creation, preserves project state and consumes repeated shortcuts", async () => {
    await i18n.changeLanguage("zh-CN");
    const workbench = (projectId: string) => <StrictMode><TooltipProvider><div style={{ height: 700, width: 1000, display: "flex" }}>
      <TerminalWorkbench enabled projectId={projectId} rootId="r" label="工作区">
        <div style={{ flex: 1, minHeight: 0 }}>CodeAgent</div><textarea aria-label="Composer" style={{ height: 80, flexShrink: 0 }} />
        <TerminalFooter><TerminalStatusTrigger /></TerminalFooter>
      </TerminalWorkbench>
    </div></TooltipProvider></StrictMode>;
    const screen = await render(workbench("shortcut-a"));
    const editor = screen.getByRole("textbox", { name: "Composer" }).element() as HTMLTextAreaElement;
    editor.focus();
    const key = (extra: KeyboardEventInit = {}) => new KeyboardEvent("keydown", { key: "j", bubbles: true, cancelable: true, metaKey: /mac/i.test(navigator.platform), ctrlKey: !/mac/i.test(navigator.platform), ...extra });
    editor.dispatchEvent(key({ isComposing: true }));
    expect(terminalStore.get("shortcut-a").visible).toBe(false);
    const modal = document.createElement("dialog");
    modal.open = true; document.body.append(modal);
    editor.dispatchEvent(key());
    expect(terminalStore.get("shortcut-a").visible).toBe(false);
    modal.remove();
    const leaked = vi.fn();
    editor.addEventListener("keydown", leaked);
    editor.dispatchEvent(key());
    await expect.element(screen.getByRole("tab", { name: "zsh" })).toBeVisible();
    editor.dispatchEvent(key({ repeat: true }));
    expect(leaked).not.toHaveBeenCalled();
    expect(terminalStore.get("shortcut-a").visible).toBe(true);
    // 此处只读取 mock 的调用记录，不会脱离实例执行方法。
    // oxlint-disable-next-line typescript/unbound-method
    expect(vi.mocked(terminalRuntime.create).mock.calls.filter(([id]) => id === "shortcut-a")).toHaveLength(1);
    editor.dispatchEvent(key());
    await expect.element(screen.getByRole("region", { name: "项目终端" })).not.toBeInTheDocument();
    await vi.waitFor(() => expect(document.activeElement).toBe(editor));
    editor.removeEventListener("keydown", leaked);
    terminalStore.update("shortcut-a", { height: 340 });
    await screen.rerender(workbench("shortcut-b"));
    await screen.getByRole("button", { name: "终端 0", exact: true }).click();
    await expect.element(screen.getByRole("button", { name: "终端 1", exact: true })).toBeVisible();
    await screen.rerender(workbench("shortcut-a"));
    await expect.element(screen.getByRole("region", { name: "项目终端" })).not.toBeInTheDocument();
    expect(terminalStore.get("shortcut-a").height).toBe(340);
    expect(terminalStore.liveCount("shortcut-b")).toBe(1);
  });

  it.each([[1280, 720], [1440, 900], [1920, 1080], [900, 500]])("keeps desktop bands separate at %i x %i", async (width, height) => {
    await i18n.changeLanguage("zh-CN");
    await page.viewport(width, height);
    const screen = await render(<TooltipProvider><div style={{ height: height - 32, width: width - 32, display: "flex" }}>
      <TerminalWorkbench enabled projectId={`geometry-${width}`} rootId="r" label="工作区">
        <header style={{ height: 48, flexShrink: 0 }}>CodeAgent</header>
        <div style={{ flex: 1, minHeight: 0 }} /><textarea aria-label="Composer" style={{ height: 80, flexShrink: 0 }} />
        <TerminalFooter><TerminalStatusTrigger /></TerminalFooter>
      </TerminalWorkbench>
    </div></TooltipProvider>);
    const emptyTrigger = screen.getByRole("button", { name: "终端 0", exact: true });
    await expect.element(emptyTrigger).toHaveTextContent("");
    await emptyTrigger.click();
    await expect.element(screen.getByRole("tab", { name: "zsh" })).toBeVisible();
    const panel = screen.getByRole("region", { name: "项目终端" }).element().getBoundingClientRect();
    const composer = screen.getByRole("textbox", { name: "Composer" }).element().getBoundingClientRect();
    const footer = screen.getByRole("button", { name: "终端 1", exact: true }).element().getBoundingClientRect();
    expect(composer.bottom).toBeLessThanOrEqual(footer.top);
    expect(footer.bottom).toBeLessThanOrEqual(panel.top);
    expect(panel.bottom).toBeLessThanOrEqual(height);
    const engine = navigator.userAgent.includes("Chrome") ? "chromium" : "webkit";
    await page.screenshot({ path: `../../../test-results/project-terminal-${engine}-${width}x${height}.png` });
    await page.viewport(1440, 900);
  });
  it("keeps composer controls together above the terminal and preserves tabs while hidden", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(<TooltipProvider><div className="bg-window" data-testid="workbench-background" style={{ height: 700, width: 1000, display: "flex" }}>
      <TerminalWorkbench enabled projectId="browser-project" rootId="r" label="工作区">
        <div className="min-h-0 flex-1">CodeAgent</div>
        <textarea aria-label="Composer" style={{ height: 80, flexShrink: 0 }} />
        <TerminalFooter><div className="flex h-9 items-center"><button type="button">待办 0</button><TerminalStatusTrigger /></div></TerminalFooter>
      </TerminalWorkbench>
    </div></TooltipProvider>);
    await screen.getByRole("button", { name: "终端 0", exact: true }).click();
    await expect.element(screen.getByRole("region", { name: "项目终端" })).toBeVisible();
    await expect.element(screen.getByRole("tab", { name: "zsh" })).toBeVisible();
    const composer = screen.getByRole("textbox", { name: "Composer" }).element().getBoundingClientRect();
    const panelElement = screen.getByRole("region", { name: "项目终端" }).element();
    const panel = panelElement.getBoundingClientRect();
    const status = screen.getByRole("button", { name: "终端 1", exact: true }).element().getBoundingClientRect();
    const terminalContainer = panelElement.parentElement;
    expect(terminalContainer).not.toBeNull();
    expect(getComputedStyle(terminalContainer!).paddingBottom).toBe("8px");
    expect(getComputedStyle(terminalContainer!).backgroundColor).toBe(
      getComputedStyle(screen.getByTestId("workbench-background").element()).backgroundColor,
    );
    expect(terminalContainer!.getBoundingClientRect().bottom).toBe(700);
    expect(composer.bottom).toBeLessThanOrEqual(status.top);
    expect(status.bottom).toBeLessThanOrEqual(panel.top);
    await screen.getByRole("button", { name: "隐藏终端", exact: true }).click();
    await expect.element(screen.getByRole("region", { name: "项目终端" })).not.toBeInTheDocument();
    await screen.getByRole("button", { name: "终端 1", exact: true }).click();
    await expect.element(screen.getByRole("tab", { name: "zsh" })).toBeVisible();
    await screen.getByRole("button", { name: "结束终端", exact: true }).click();
    await expect.element(screen.getByRole("tab", { name: "zsh" })).not.toBeInTheDocument();
    await expect.element(screen.getByRole("region", { name: "项目终端" })).not.toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "终端 0", exact: true })).toHaveTextContent("");
  });
});
