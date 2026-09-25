import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { WebglAddon } from "@xterm/addon-webgl";
import { TERMINAL_LIMITS } from "../../protocol/project-terminal.js";
import { trackTestTerminal, trackTestWrite } from "./terminal-test-metrics.js";

export type EmulatorCallbacks = { data: (text: string) => void; binary?: (text: string) => void; resize: (cols: number, rows: number) => void };
export type TerminalEmulator = {
  write: (bytes: Uint8Array, parsed: () => void) => void;
  attach: (host: HTMLElement) => void;
  detach: () => void;
  focus: () => void;
  setExited: () => void;
  dispose: () => void;
};

export async function createTerminalEmulator(callbacks: EmulatorCallbacks): Promise<TerminalEmulator> {
  // xterm、插件与样式均在首次创建后才加载，不进入工作台首屏路径。
  const [{ Terminal }, { FitAddon }, { WebglAddon }] = await Promise.all([
    import("@xterm/xterm"), import("@xterm/addon-fit"), import("@xterm/addon-webgl"), import("@xterm/xterm/css/xterm.css"),
  ]);
  return new Emulator(new Terminal({ cols: 80, rows: 24, scrollback: TERMINAL_LIMITS.scrollback, fontSize: 13, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", cursorBlink: false, allowTransparency: false }), new FitAddon(), WebglAddon, callbacks);
}

class Emulator implements TerminalEmulator {
  private readonly terminal: Terminal;
  private readonly fit: FitAddon;
  private readonly Webgl: typeof WebglAddon;
  private readonly callbacks: EmulatorCallbacks;
  private webgl: WebglAddon | undefined;
  private host: HTMLElement | undefined;
  private observer: ResizeObserver | undefined;
  private frame: number | undefined;
  private webglRelease: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private releaseTestMetrics: (() => void) | undefined;
  private readonly visibility = () => {
    const element = this.terminal.element;
    if (element !== undefined) element.style.display = document.hidden ? "none" : "";
    if (document.hidden) this.releaseWebgl(); else if (this.host !== undefined) this.render();
  };

  constructor(terminal: Terminal, fit: FitAddon, Webgl: typeof WebglAddon, callbacks: EmulatorCallbacks) {
    this.terminal = terminal; this.fit = fit; this.Webgl = Webgl; this.callbacks = callbacks;
    if (import.meta.env.VITE_WEBVIEW_TEST === "1") this.releaseTestMetrics = trackTestTerminal(terminal);
    terminal.loadAddon(fit);
    terminal.onData(callbacks.data);
    terminal.onBinary((text) => callbacks.binary?.(text));
    terminal.attachCustomKeyEventHandler((event) => {
      // 有选区时 Ctrl+C 是用户复制操作；无选区才由 xterm 发送 ETX 中断前台作业。
      if (event.type === "keydown" && event.key.toLowerCase() === "c" && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && terminal.hasSelection()) {
        event.preventDefault();
        document.execCommand("copy");
        return false;
      }
      return true;
    });
    // 不授予终端程序自动访问剪贴板的能力，也不安装自动打开链接的插件。
    terminal.parser.registerOscHandler(52, () => true);
    document.addEventListener("visibilitychange", this.visibility);
  }

  write(bytes: Uint8Array, parsed: () => void): void {
    if (this.disposed) return;
    if (import.meta.env.VITE_WEBVIEW_TEST === "1") trackTestWrite(this.terminal, bytes, parsed);
    else this.terminal.write(bytes, parsed);
  }
  focus(): void { if (!this.disposed && this.host !== undefined) this.terminal.focus(); }
  setExited(): void { this.terminal.options.disableStdin = true; }

  attach(host: HTMLElement): void {
    if (this.disposed || this.host === host) return;
    this.detach();
    this.cancelWebglRelease();
    this.host = host;
    if (this.terminal.element === undefined) this.terminal.open(host);
    else host.append(this.terminal.element);
    this.observer = new ResizeObserver(() => this.scheduleFit());
    this.observer.observe(host);
    this.visibility();
  }

  detach(): void {
    this.observer?.disconnect(); this.observer = undefined;
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    // Let the next tab acquire xterm's shared glyph atlas before its last owner releases it.
    if (this.webgl !== undefined && this.webglRelease === undefined) {
      this.webglRelease = setTimeout(() => this.releaseWebgl(), 0);
    }
    this.terminal.element?.remove();
    this.host = undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseTestMetrics?.();
    this.detach();
    this.releaseWebgl();
    document.removeEventListener("visibilitychange", this.visibility);
    this.terminal.dispose();
  }

  private render(): void {
    if (this.webgl === undefined) {
      try {
        const addon = new this.Webgl();
        this.webgl = addon;
        this.terminal.loadAddon(addon);
        addon.onContextLoss(() => { this.releaseWebgl(); this.terminal.refresh(0, this.terminal.rows - 1); });
      } catch { this.releaseWebgl(); }
    }
    const style = this.host === undefined ? undefined : getComputedStyle(this.host);
    this.terminal.options.theme = { background: style?.backgroundColor ?? "#181818", foreground: style?.color ?? "#f5f5f5", cursor: style?.color ?? "#f5f5f5" };
    this.scheduleFit();
    this.terminal.refresh(0, this.terminal.rows - 1);
  }

  private cancelWebglRelease(): void {
    if (this.webglRelease !== undefined) clearTimeout(this.webglRelease);
    this.webglRelease = undefined;
  }
  private releaseWebgl(): void {
    this.cancelWebglRelease();
    this.webgl?.dispose(); this.webgl = undefined;
  }
  private scheduleFit(): void {
    if (this.frame !== undefined || this.host === undefined || document.hidden) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      if (this.host === undefined || this.host.clientWidth === 0 || this.host.clientHeight === 0) return;
      const size = this.fit.proposeDimensions();
      if (size === undefined) return;
      const cols = Math.max(1, Math.min(TERMINAL_LIMITS.maxCols, size.cols));
      const rows = Math.max(1, Math.min(TERMINAL_LIMITS.maxRows, size.rows));
      if (cols !== this.terminal.cols || rows !== this.terminal.rows) {
        this.terminal.resize(cols, rows);
        this.callbacks.resize(cols, rows);
      }
    });
  }
}
