import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { createTerminalEmulator, type TerminalEmulator } from "./terminal-emulator.js";
import "./components/terminal.css";

let emulator: TerminalEmulator | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => { emulator?.dispose(); host?.remove(); vi.restoreAllMocks(); });

async function setup(fallback = false) {
  const open = vi.spyOn(Terminal.prototype, "open");
  if (fallback) vi.spyOn(WebglAddon.prototype, "activate").mockImplementation(() => { throw new Error("WEBGL_UNAVAILABLE"); });
  host = document.createElement("div");
  host.className = "project-terminal-viewport";
  Object.assign(host.style, { width: "960px", height: "300px", position: "absolute", top: "0", left: "0" });
  document.body.append(host);
  const data = vi.fn();
  emulator = await createTerminalEmulator({ data, resize: vi.fn() });
  emulator.attach(host);
  const terminal = open.mock.contexts[0] as Terminal;
  expect(terminal).toBeInstanceOf(Terminal);
  return { terminal, data, emulator, host };
}

describe("terminal emulator rendering", () => {
  it("shares the glyph atlas during a tab handoff and releases the detached renderer", async () => {
    const activate = vi.spyOn(WebglAddon.prototype, "activate");
    const dispose = vi.spyOn(WebglAddon.prototype, "dispose");
    const { emulator, host } = await setup();
    const previous = activate.mock.contexts[0] as WebglAddon;
    await vi.waitFor(() => expect(previous.textureAtlas).toBeDefined());
    const atlas = previous.textureAtlas;
    const next = await createTerminalEmulator({ data: vi.fn(), resize: vi.fn() });
    try {
      emulator.detach();
      next.attach(host);
      const current = activate.mock.contexts[1] as WebglAddon;
      expect(current.textureAtlas).toBe(atlas);
      await vi.waitFor(() => expect(dispose.mock.contexts).toContain(previous));
      expect(dispose.mock.contexts).not.toContain(current);
      next.detach();
      next.attach(host);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(dispose.mock.contexts).not.toContain(current);
      next.detach();
      next.dispose();
      expect(dispose.mock.contexts).toContain(current);
    } finally {
      next.dispose();
    }
  });

  it("parses while detached without rendering and preserves the buffer on reattach", async () => {
    const { terminal, emulator, host } = await setup();
    await new Promise<void>((resolve) => emulator.write(new TextEncoder().encode("CodeAgent terminal\r\n\x1b[31mRED\x1b[0m UTF-8: 中文\r\n"), resolve));
    await vi.waitFor(() => expect(terminal.cols).toBeGreaterThan(80));
    const render = vi.fn();
    const subscription = terminal.onRender(render);
    emulator.detach();
    // 等 IntersectionObserver 完成不可见状态通知，再统计后续输出是否触发渲染。
    await new Promise((resolve) => setTimeout(resolve, 100));
    render.mockClear();
    await new Promise<void>((resolve) => emulator.write(new TextEncoder().encode("HIDDEN_PARSED\r\n"), resolve));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(render).not.toHaveBeenCalled();
    const lines = Array.from({ length: terminal.buffer.active.length }, (_, index) => terminal.buffer.active.getLine(index)?.translateToString(true)).join("\n");
    expect(lines).toContain("HIDDEN_PARSED");
    emulator.attach(host);
    await vi.waitFor(() => expect(render).toHaveBeenCalled());
    await page.screenshot({ path: "../../../test-results/project-terminal-emulator.png" });
    subscription.dispose();
  });

  it("falls back to DOM and copies selected text without sending an interrupt", async () => {
    const { terminal, data, emulator, host } = await setup(true);
    const copy = vi.spyOn(document, "execCommand").mockReturnValue(true);
    await new Promise<void>((resolve) => emulator.write(new TextEncoder().encode("DOM_FALLBACK\r\n"), resolve));
    await vi.waitFor(() => expect(host.textContent).toContain("DOM_FALLBACK"));
    terminal.select(0, 0, 3);
    emulator.focus();
    terminal.textarea!.dispatchEvent(new KeyboardEvent("keydown", { key: "c", code: "KeyC", keyCode: 67, ctrlKey: true, bubbles: true, cancelable: true }));
    expect(copy).toHaveBeenCalledWith("copy");
    expect(data).not.toHaveBeenCalled();
    terminal.clearSelection();
    terminal.textarea!.dispatchEvent(new KeyboardEvent("keydown", { key: "c", code: "KeyC", keyCode: 67, ctrlKey: true, bubbles: true, cancelable: true }));
    expect(data).toHaveBeenCalledWith("\x03");
  });
});
