import { browser, expect } from "@wdio/globals";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, platform, release, totalmem } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { installWebviewMocks, passthroughNativeCommands, releaseApplicationStartup } from "../../tests/webview/mock-runtime.js";
import { sampleResources, summarizeResources, type ResourceSample } from "./resources.js";
import type { TerminalMetadata } from "../../src/protocol/project-terminal.js";
import { windowsTerminalNative } from "../../tests/webview/windows-terminal-native.js";

type NativeMetrics = { appPid: number; liveCount: number; sessions: { pid: number | null; outstandingBytes: number; queuedInputBytes: number }[] };
type EmulatorMetric = { parsedBytes: number; pendingBytes: number; peakPendingBytes: number; renders: number; lines: number; cols: number; rows: number; parseSamplesMs: number[] };
type TestWindow = Window & {
  __TAURI__: { core: { invoke: <T>(command: string, args?: unknown, options?: { headers: Record<string, string> }) => Promise<T> } };
  __terminalInputSequences: Record<string, number>;
  __CODEAGENT_TERMINAL_TEST__: { create: (projectId: string, rootId: string) => Promise<void>; scopes: () => TerminalMetadata[]; close: (scope: TerminalMetadata) => Promise<void> };
  __CODEAGENT_TERMINAL_METRICS__: () => EmulatorMetric[];
};

async function nativeMetrics(): Promise<NativeMetrics> {
  const result = await browser.executeAsync((done: (value: NativeMetrics | string) => void) => {
    (window as TestWindow).__TAURI__.core.invoke<NativeMetrics>("inspect_project_terminal_test").then(done, (error: unknown) => done(String(error)));
  });
  if (typeof result === "string") throw new Error(result);
  return result;
}

async function observe(label: string, native: NativeMetrics, durationMs: number) {
  const samples: (ResourceSample & { visible: boolean; maxOutstandingBytes: number; maxQueuedInputBytes: number })[] = [];
  const started = performance.now();
  const pids = native.sessions.flatMap((session) => session.pid === null ? [] : [session.pid]);
  do {
    const sample = await sampleResources(native.appPid, pids, started);
    const current = await nativeMetrics();
    const visible = await browser.execute(() => !document.hidden);
    samples.push({ ...sample, visible, maxOutstandingBytes: Math.max(0, ...current.sessions.map((session) => session.outstandingBytes)), maxQueuedInputBytes: Math.max(0, ...current.sessions.map((session) => session.queuedInputBytes)) });
    if (performance.now() - started >= durationMs) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(5000, durationMs - (performance.now() - started))));
  } while (performance.now() - started <= durationMs + 5000);
  console.log("terminal measurement", label, summarizeResources(samples));
  return { label, samples, summary: summarizeResources(samples) };
}

describe("Release native terminal measurements", () => {
  before(async function () {
    if (!["darwin", "win32"].includes(process.platform) || process.env.CODEAGENT_WEBVIEW_RELEASE !== "1") { this.skip(); return; }
    await installWebviewMocks();
    await passthroughNativeCommands(["connect_project_terminals", "create_project_terminal", "write_project_terminal", "resize_project_terminal", "ack_project_terminal", "close_project_terminal", "remove_project_terminal"]);
    await browser.execute(() => {
      const target = window as TestWindow;
      target.__terminalInputSequences = {};
      const original = window.__CODEAGENT_WEBVIEW_TEST_INVOKE__!;
      window.__CODEAGENT_WEBVIEW_TEST_INVOKE__ = (command, args, options) => {
        if (command === "write_project_terminal") {
          const headers = options?.headers as Record<string, string>;
          target.__terminalInputSequences[decodeURIComponent(headers["x-codeagent-terminal-id"]!)] = Number(headers["x-codeagent-input-sequence"]);
        }
        return original(command, args, options);
      };
    });
    await releaseApplicationStartup();
    await $("aria/自定义 API").click();
    await $("aria/API Base URL").setValue("https://gateway.test/v1");
    await $("aria/API Key（可选）").setValue("sk-webview-test");
    await $("aria/连接").click();
    await $("aria/终端 0").waitForExist();
    if (process.platform === "win32") {
      // 资源采样仅要求窗口可见；已可见时不额外争抢系统前台输入焦点。
      if (await browser.execute(() => document.hidden)) await windowsTerminalNative("activate");
    } else {
      const executable = resolve("src-tauri/target/aarch64-apple-darwin/release/codeagent");
      await promisify(execFile)("swift", ["-e", "import AppKit; let path = CommandLine.arguments[1]; for app in NSWorkspace.shared.runningApplications where app.executableURL?.path == path { print(app.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])) }", executable]);
    }
    await browser.waitUntil(async () => browser.execute(() => !document.hidden));
    if (process.platform === "win32") {
      const window = await windowsTerminalNative("inspect");
      const native = await nativeMetrics();
      const resources = await sampleResources(native.appPid, [], performance.now());
      const pids = new Set(resources.processes?.map((row) => row.pid));
      const children = window.children as string[];
      expect(children.some((child) => child.startsWith("Chrome_RenderWidgetHostHWND:"))).toBe(true);
      expect(children.every((child) => pids.has(Number(child.split(":").at(-1))))).toBe(true);
      expect(window.mainVisible).toBe(true);
    }
  });

  it("records baseline, 1/12 idle sessions, bounded output and cleanup", async () => {
    const phases: Awaited<ReturnType<typeof observe>>[] = [];
    const initial = await nativeMetrics();
    expect(initial.liveCount).toBe(0);
    phases.push(await observe("baseline-no-terminal", initial, 60000));
    let renderer: EmulatorMetric[] = [];
    let idleTerminalCalls = 0;
    let outputMetrics: NativeMetrics | undefined;
    let cleanupMs = 0;
    try {
      await $("aria/终端 0").click();
      await $("aria/终端 1").waitForExist();
      await browser.pause(2000);
      phases.push(await observe("one-idle-terminal", await nativeMetrics(), 60000));
      const result = await browser.executeAsync((done) => {
        const api = (window as TestWindow).__CODEAGENT_TERMINAL_TEST__;
        void (async () => {
          for (const [project, root, count] of [["codeagent", "root-codeagent", 3], ["codexly", "root-codexly", 4], ["terminal-bench-third", "root-terminal-bench-third", 4]] as const) {
            for (let index = 0; index < count; index += 1) await api.create(project, root);
          }
          done("ok");
        })().catch((error: unknown) => done(String(error)));
      });
      expect(result).toBe("ok");
      await browser.pause(2000);
      const twelve = await nativeMetrics();
      expect(twelve.liveCount).toBe(12);
      const countCalls = () => browser.execute(() => Object.entries(window.__CODEAGENT_WEBVIEW_TEST_BRIDGE__?.calls ?? {}).filter(([name]) => name.includes("project_terminal")).reduce((total, [, calls]) => total + calls.length, 0));
      // 资源采样不需要输入焦点；先排空失焦通知，避免把 ESC[O 误算为空闲轮询。
      await browser.execute(() => { (document.activeElement as HTMLElement | null)?.blur(); });
      // 等待 shell 启动输出的 ACK、resize 与焦点通知排空，再开始空闲计数。
      let lastCalls = await countCalls();
      let quietSince = performance.now();
      await browser.waitUntil(async () => {
        const current = await countCalls();
        if (current !== lastCalls) { lastCalls = current; quietSince = performance.now(); }
        return performance.now() - quietSince >= 2000;
      }, { timeout: 20000, interval: 250, timeoutMsg: "Terminal startup did not become idle" });
      const before = await countCalls();
      for (let round = 1; round <= 3; round += 1) phases.push(await observe(`twelve-idle-${round}`, twelve, 60000));
      idleTerminalCalls = (await countCalls()) - before;
      expect(idleTerminalCalls).toBe(0);
      await browser.execute((windows) => {
        const textarea = document.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")!;
        const command = windows ? "1..600 | ForEach-Object { [Console]::Write(('0123456789abcdef' * 512) + \"`r`n\"); Start-Sleep -Milliseconds 100 }" : "python3 -u -c 'import os,time; [(os.write(1,b\"0123456789abcdef\"*512+b\"\\r\\n\"),time.sleep(.1)) for _ in range(600)]'";
        const paste = new Event("paste", { bubbles: true, cancelable: true });
        Object.defineProperty(paste, "clipboardData", { value: { getData: () => command } });
        textarea.dispatchEvent(paste);
        textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
      }, process.platform === "win32");
      phases.push(await observe("sixty-second-output", twelve, 65000));
      outputMetrics = await nativeMetrics();
      renderer = await browser.execute(() => (window as TestWindow).__CODEAGENT_TERMINAL_METRICS__());
      expect(renderer.reduce((total, value) => total + value.parsedBytes, 0)).toBeGreaterThan(4 * 1024 * 1024);
      expect(renderer.every((value) => value.peakPendingBytes <= 272 * 1024 && value.lines <= 3200)).toBe(true);
      expect(outputMetrics.sessions.every((value) => value.outstandingBytes <= 256 * 1024 && value.queuedInputBytes <= 64 * 1024)).toBe(true);
      if (process.platform === "win32") {
        const beforeOutput = renderer.reduce((total, value) => total + value.parsedBytes, 0);
        const written = await browser.executeAsync((done) => {
          const target = window as TestWindow;
          // Startup replies already use the real frontend input sequence. These
          // controlled producers are the final writes before closing all sessions.
          Promise.all(target.__CODEAGENT_TERMINAL_TEST__.scopes().map(async (scope) => {
            const sequence = (target.__terminalInputSequences[scope.terminalId] ?? 0) + 1;
            const headers = { "x-codeagent-project-id": encodeURIComponent(scope.projectId), "x-codeagent-terminal-id": encodeURIComponent(scope.terminalId), "x-codeagent-generation": encodeURIComponent(scope.generation), "x-codeagent-input-sequence": String(sequence) };
            const command = "1..300 | ForEach-Object { [Console]::Write(('0123456789abcdef' * 512) + \"`r`n\"); Start-Sleep -Milliseconds 100 }\r";
            await target.__TAURI__.core.invoke("write_project_terminal", new TextEncoder().encode(command), { headers });
          })).then(() => done("written"), (error: unknown) => done(String(error)));
        });
        expect(written).toBe("written");
        phases.push(await observe("twelve-output", twelve, 35000));
        renderer = await browser.execute(() => (window as TestWindow).__CODEAGENT_TERMINAL_METRICS__());
        expect(renderer.reduce((total, value) => total + value.parsedBytes, 0) - beforeOutput).toBeGreaterThan(24 * 1024 * 1024);
        phases.push(await observe("recovered-idle", twelve, 30000));
      }
    } catch (error) {
      console.error("terminal measurement failed before cleanup", error);
      throw error;
    } finally {
      const started = performance.now();
      const cleanup = await browser.executeAsync((done) => {
        const api = (window as TestWindow).__CODEAGENT_TERMINAL_TEST__;
        if (api === undefined) { done("empty"); return; }
        Promise.all(api.scopes().map((scope) => api.close(scope))).then(() => done("closed"), (error: unknown) => done(String(error)));
      });
      cleanupMs = performance.now() - started;
      const closed = await nativeMetrics();
      const visibility = await browser.execute(() => document.visibilityState);
      const report = {
        measuredAt: new Date().toISOString(), build: "Release + webview-tests", platform: platform(), osRelease: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(), webview: browser.capabilities.browserVersion, visibility,
        scope: process.platform === "win32" ? "App PID, direct shells and app descendants including WebView2/GPU. RSS is the sum of Windows working sets (shared pages may be counted more than once); private bytes are also recorded. CPU is process time / wall time (100% = one logical core). Exited process CPU after its last sample is not captured. Fixture roots use a temporary directory; shells use user profiles." : "App PID and its direct shell PIDs only; WebContent/GPU RSS not attributed. macOS test driver has a 50ms main-runloop pump. Fixture roots use a temporary directory; shells use user login profiles.",
        phases, idleTerminalCalls, renderer, outputMetrics, cleanupMs, remainingNativeSessions: closed.liveCount,
        unverified: [...(process.platform === "win32" ? [] : ["WebContent/GPU memory"]), "physical display presentation latency", ...(visibility === "hidden" ? ["native visible render"] : [])],
      };
      await mkdir("artifacts/terminal", { recursive: true });
      await writeFile(`artifacts/terminal/release-native-measurements${process.platform === "win32" ? "-windows" : ""}.json`, JSON.stringify(report, null, 2));
      expect(cleanup).toBe("closed");
      expect(closed.liveCount).toBe(0);
      expect(cleanupMs).toBeLessThan(3000);
    }
    expect(phases.every((phase) => phase.samples.every((sample) => sample.visible && sample.maxOutstandingBytes <= 256 * 1024 && sample.maxQueuedInputBytes <= 64 * 1024))).toBe(true);
    const baselineCpu = phases[0]!.summary.appCpuPercent;
    expect(phases.filter((phase) => phase.label.startsWith("twelve-idle")).every((phase) => phase.summary.appCpuPercent - baselineCpu < 1)).toBe(true);
  });
});
