import { browser, expect } from "@wdio/globals";

import { streamTaskResponse } from "./fixtures.js";
import { installWebviewMocks } from "./mock-runtime.js";

const SAMPLE_COUNT = 10;
const STARTUP_BUDGET_MS = Number(process.env.CODEAGENT_STARTUP_BUDGET_MS ?? "5000");
const RENDER_BUDGET_MS = Number(process.env.CODEAGENT_RENDER_BUDGET_MS ?? "500");
const NATIVE_ENGINE =
  { darwin: "WKWebView", linux: "WebKitGTK", win32: "WebView2" }[process.platform] ??
  process.platform;

type BrowserMeasurement = Readonly<{ durationMs?: number; error?: string }>;
type MeasurementWindow = Window &
  typeof globalThis & {
    __CODEAGENT_INTERACTIVE_SAMPLE__?: BrowserMeasurement;
    __CODEAGENT_RENDER_SAMPLE__?: BrowserMeasurement;
  };

function percentile(values: readonly number[], ratio: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * ratio) - 1)] ?? 0;
}

async function measureStartupToInteractive(): Promise<number> {
  await browser.execute(() => {
    const measuredWindow = window as MeasurementWindow;
    const startedAt = performance.now();
    const observer = new MutationObserver(() => inspect());
    let measuring = true;
    const inspect = () => {
      const interactive = [...document.querySelectorAll("button")].some(
        (button) =>
          button.textContent?.includes("自定义 API") === true &&
          !button.disabled &&
          button.getClientRects().length > 0,
      );
      if (!interactive || !measuring) return;
      measuring = false;
      observer.disconnect();
      requestAnimationFrame(() => {
        measuredWindow.__CODEAGENT_INTERACTIVE_SAMPLE__ = {
          durationMs: performance.now() - startedAt,
        };
      });
    };
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.setTimeout(() => {
      if (!measuring) return;
      measuring = false;
      observer.disconnect();
      measuredWindow.__CODEAGENT_INTERACTIVE_SAMPLE__ = {
        error: "首次可交互控件未在 10 秒内出现",
      };
    }, 10_000);
    measuredWindow.__CODEAGENT_WEBVIEW_TEST_READY__ = true;
    inspect();
  });
  await browser.waitUntil(
    async () =>
      browser.execute(
        () => (window as MeasurementWindow).__CODEAGENT_INTERACTIVE_SAMPLE__ !== undefined,
      ),
    { timeout: 12_000, timeoutMsg: "未生成启动性能样本" },
  );
  const sample = await browser.execute(
    () => (window as MeasurementWindow).__CODEAGENT_INTERACTIVE_SAMPLE__,
  );
  if (sample?.error !== undefined) throw new Error(sample.error);
  if (sample?.durationMs === undefined) throw new Error("启动性能样本无效");
  return sample.durationMs;
}

async function measureDeltaRender(iteration: number): Promise<number> {
  const expected = `原生渲染基线-${String(iteration)}`;
  await browser.execute(
    (input) => {
      const measuredWindow = window as MeasurementWindow;
      const channel = measuredWindow.__CODEAGENT_RUNTIME_CHANNEL__;
      if (channel === undefined) {
        measuredWindow.__CODEAGENT_RENDER_SAMPLE__ = { error: "Runtime channel 未连接" };
        return;
      }
      delete measuredWindow.__CODEAGENT_RENDER_SAMPLE__;
      const startedAt = performance.now();
      let measuring = true;
      const observer = new MutationObserver(() => {
        if (!measuring || !document.body.innerText.includes(input.expected)) return;
        measuring = false;
        observer.disconnect();
        // 下一帧记录包含 React commit 与 WebView render 的完整延迟。
        requestAnimationFrame(() => {
          measuredWindow.__CODEAGENT_RENDER_SAMPLE__ = {
            durationMs: performance.now() - startedAt,
          };
        });
      });
      observer.observe(document.body, { characterData: true, childList: true, subtree: true });
      window.setTimeout(() => {
        if (!measuring) return;
        measuring = false;
        observer.disconnect();
        measuredWindow.__CODEAGENT_RENDER_SAMPLE__ = { error: "渲染样本超时" };
      }, 5_000);
      channel.onmessage({ data: { event: input.event }, type: "agentEvent" });
    },
    {
      event: {
        itemId: "assistant-stream",
        payload: { delta: expected },
        provider: "codex",
        sequence: iteration + 1,
        sessionId: "session-stream-task",
        taskId: "stream-task",
        timestamp: new Date().toISOString(),
        turnId: "turn-stream",
        type: "message.delta",
        version: 2,
      },
      expected,
    },
  );
  await browser.waitUntil(
    async () =>
      browser.execute(() => (window as MeasurementWindow).__CODEAGENT_RENDER_SAMPLE__ !== undefined),
    { timeout: 7_000, timeoutMsg: `未生成第 ${String(iteration + 1)} 个渲染样本` },
  );
  const sample = await browser.execute(
    () => (window as MeasurementWindow).__CODEAGENT_RENDER_SAMPLE__,
  );
  if (sample?.error !== undefined) throw new Error(sample.error);
  if (sample?.durationMs === undefined) throw new Error("渲染性能样本无效");
  return sample.durationMs;
}

describe("原生 WebView 性能基线", () => {
  it("限制启动和 Runtime delta commit/render 延迟", async () => {
    const mocks = await installWebviewMocks();
    const startupToInteractiveMs = await measureStartupToInteractive();

    const customMode = await $("aria/自定义 API");
    await customMode.waitForClickable();
    await customMode.click();
    await $("aria/API Base URL").setValue("https://gateway.test/v1");
    await $("aria/连接").click();
    await expect($("aria/切换项目 CodeAgent")).toBeDisplayed();

    await mocks.readTask.mockResolvedValue(streamTaskResponse);
    const task = await $('//a[.//span[normalize-space(.)="验证流式消息"]]');
    await task.click();
    await expect(task).toHaveAttribute("aria-current", "page");

    const renderSamples: number[] = [];
    for (let iteration = 0; iteration < SAMPLE_COUNT; iteration += 1) {
      renderSamples.push(await measureDeltaRender(iteration));
    }
    const result = {
      engine: NATIVE_ENGINE,
      renderP50Ms: percentile(renderSamples, 0.5),
      renderP95Ms: percentile(renderSamples, 0.95),
      startupToInteractiveMs,
    };
    console.log(`PERFORMANCE_BASELINE ${JSON.stringify(result)}`);

    expect(result.startupToInteractiveMs).toBeLessThanOrEqual(STARTUP_BUDGET_MS);
    expect(result.renderP95Ms).toBeLessThanOrEqual(RENDER_BUDGET_MS);
  });
});
