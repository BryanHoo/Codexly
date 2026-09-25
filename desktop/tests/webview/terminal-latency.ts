import { browser } from "@wdio/globals";
import { postTerminalSystemText } from "./terminal-system-keyboard.js";

type Metric = { renders: number; parsedBytes: number; renderedAt: number; parsedAt: number };
type Measurement = { samplesMs: number[]; inputToOutputMs: number[]; outputToRenderMs: number[]; outputToParsedMs: number[]; animationFrameMs: number[]; error?: string };

export async function measureTerminalLatency(mode: "input" | "switch"): Promise<Measurement> {
  const { script } = await browser.getTimeouts();
  // 200 observations include frame pacing; the batch can exceed WebDriver's 30s default.
  await browser.setTimeout({ script: 60_000 });
  try {
    return await measureTerminalLatencyBatch(mode);
  } finally {
    await browser.setTimeout({ script });
  }
}

async function measureTerminalLatencyBatch(mode: "input" | "switch"): Promise<Measurement> {
  return browser.executeAsync((kind, done: (value: Measurement) => void) => {
    const metrics = () => (window as unknown as { __CODEAGENT_TERMINAL_METRICS__: () => Metric[] }).__CODEAGENT_TERMINAL_METRICS__();
    const totals = () => metrics().reduce((total, value) => ({ renders: total.renders + value.renders, bytes: total.bytes + value.parsedBytes, renderedAt: Math.max(total.renderedAt, value.renderedAt), parsedAt: Math.max(total.parsedAt, value.parsedAt) }), { renders: 0, bytes: 0, renderedAt: 0, parsedAt: 0 });
    const samplesMs: number[] = [];
    const inputToOutputMs: number[] = [];
    const outputToRenderMs: number[] = [];
    const outputToParsedMs: number[] = [];
    const animationFrameMs: number[] = [];
    const target = window as unknown as { __terminalSystemProbe?: { nativeOutput: () => void } };
    const previousProbe = target.__terminalSystemProbe;
    let outputAt: number | undefined;
    if (kind === "input") target.__terminalSystemProbe = { nativeOutput: () => { outputAt ??= performance.now(); } };
    const finish = (error?: string) => {
      if (kind === "input") target.__terminalSystemProbe = previousProbe;
      done({ samplesMs, inputToOutputMs, outputToRenderMs, outputToParsedMs, animationFrameMs, ...(error === undefined ? {} : { error }) });
    };
    const next = () => {
      if (document.hidden) { finish("WEBVIEW_HIDDEN"); return; }
      const before = totals();
      outputAt = undefined;
      const started = performance.now();
      if (kind === "input") {
        const textarea = document.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")!;
        const paste = new Event("paste", { bubbles: true, cancelable: true });
        Object.defineProperty(paste, "clipboardData", { value: { getData: () => "a" } });
        textarea.dispatchEvent(paste);
      } else {
        const tabs = document.querySelectorAll<HTMLButtonElement>('[data-project-terminal] [role="tab"]');
        const target = [...tabs].find((tab) => tab.getAttribute("aria-selected") !== "true");
        if (target === undefined) { finish("SECOND_TERMINAL_REQUIRED"); return; }
        target.click();
      }
      // rAF 仅轮询完成状态；耗时使用 onRender 内保存的时刻，不包含轮询延迟。
      let lastFrame: number | undefined;
      const inspect = (frameTime: number) => {
        if (lastFrame !== undefined && animationFrameMs.length < 200) animationFrameMs.push(frameTime - lastFrame);
        lastFrame = frameTime;
        if (performance.now() - started > 2000) { finish("RENDER_TIMEOUT"); return; }
        const current = totals();
        if (current.renders > before.renders && current.renderedAt >= current.parsedAt && (kind === "switch" || current.bytes > before.bytes)) {
          samplesMs.push(current.renderedAt - started);
          if (outputAt !== undefined) {
            inputToOutputMs.push(outputAt - started);
            outputToRenderMs.push(current.renderedAt - outputAt);
            outputToParsedMs.push(current.parsedAt - outputAt);
          }
          if (samplesMs.length === 200) finish();
          else requestAnimationFrame(next);
        } else requestAnimationFrame(inspect);
      };
      requestAnimationFrame(inspect);
    };
    next();
  }, mode);
}

export function summarizeLatency(samplesMs: number[]) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  return { count: sorted.length, p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1], p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], maxMs: sorted.at(-1) };
}

type SystemProbe = { samplesMs: number[]; inputToOutputMs: number[]; outputToRenderMs: number[]; trustedKeys: number; error?: string; nativeOutput: () => void; stop: () => void };
type ProbeWindow = Window & { __terminalSystemProbe: SystemProbe; __CODEAGENT_TERMINAL_METRICS__: () => Metric[] };

export async function measureSystemInputLatency() {
  await browser.execute(() => {
    const target = window as ProbeWindow;
    const samplesMs: number[] = [];
    const inputToOutputMs: number[] = [];
    const outputToRenderMs: number[] = [];
    let frame = 0;
    let pending = false;
    let outputAt: number | undefined;
    const totals = () => target.__CODEAGENT_TERMINAL_METRICS__().reduce((total, value) => ({ renders: total.renders + value.renders, bytes: total.bytes + value.parsedBytes, renderedAt: Math.max(total.renderedAt, value.renderedAt), parsedAt: Math.max(total.parsedAt, value.parsedAt) }), { renders: 0, bytes: 0, renderedAt: 0, parsedAt: 0 });
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "a") return;
      if (!event.isTrusted) { target.__terminalSystemProbe.error = "UNTRUSTED_KEY"; return; }
      target.__terminalSystemProbe.trustedKeys += 1;
      if (pending) { target.__terminalSystemProbe.error = "OVERLAPPING_INPUT"; return; }
      pending = true;
      outputAt = undefined;
      const before = totals();
      const started = performance.now();
      const inspect = () => {
        if (document.hidden || performance.now() - started > 2000) { target.__terminalSystemProbe.error = "RENDER_UNAVAILABLE"; pending = false; return; }
        const current = totals();
        if (current.renders > before.renders && current.bytes > before.bytes && current.renderedAt >= current.parsedAt) {
          const rendered = current.renderedAt;
          samplesMs.push(rendered - started);
          if (outputAt !== undefined) { inputToOutputMs.push(outputAt - started); outputToRenderMs.push(rendered - outputAt); }
          pending = false;
        }
        else frame = requestAnimationFrame(inspect);
      };
      frame = requestAnimationFrame(inspect);
    };
    target.__terminalSystemProbe = { samplesMs, inputToOutputMs, outputToRenderMs, trustedKeys: 0, nativeOutput: () => { if (pending && outputAt === undefined) outputAt = performance.now(); }, stop: () => { document.removeEventListener("keydown", keydown, true); cancelAnimationFrame(frame); } };
    document.addEventListener("keydown", keydown, true);
    document.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")!.focus();
  });
  try {
    await postTerminalSystemText("a".repeat(200), 250000, false);
    await browser.pause(200);
    return await browser.execute(() => {
      const { samplesMs, inputToOutputMs, outputToRenderMs, trustedKeys, error } = (window as ProbeWindow).__terminalSystemProbe;
      return { samplesMs, inputToOutputMs, outputToRenderMs, trustedKeys, failure: error ?? null };
    });
  } finally {
    await browser.execute((windows) => {
      (window as ProbeWindow).__terminalSystemProbe.stop();
      document.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: windows ? "c" : "u", code: windows ? "KeyC" : "KeyU", keyCode: windows ? 67 : 85, ctrlKey: true, bubbles: true, cancelable: true }));
    }, process.platform === "win32");
  }
}
