import { resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import type { Options } from "@wdio/types";

const executable = process.platform === "win32" ? "codeagent.exe" : "codeagent";
const targetPath =
  process.platform === "darwin" ? ["target", "aarch64-apple-darwin"] : ["target"];
const buildProfile = process.env.CODEAGENT_WEBVIEW_RELEASE === "1" ? "release" : "debug";
const appBinaryPath = resolve("src-tauri", ...targetPath, buildProfile, executable);
const realRuntimeEnabled = process.env.CODEAGENT_REAL_RUNTIME_TEST === "1";
const performanceEnabled = process.env.CODEAGENT_WEBVIEW_PERFORMANCE_TEST === "1";

export const config: Options.Testrunner = {
  bail: 0,
  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": { application: appBinaryPath },
    },
  ],
  connectionRetryCount: 1,
  connectionRetryTimeout: 90_000,
  framework: "mocha",
  logLevel: "warn",
  maxInstances: 1,
  // WDIO 在执行 hook 前捕获超时；hook 内 this.timeout 无法延长外层计时器。
  // 仅真实运行时模式预留受控下载窗口，普通交互与性能测试仍保持一分钟上限。
  mochaOpts: { timeout: realRuntimeEnabled ? 20 * 60_000 : 60_000, ui: "bdd" },
  reporters: ["spec"],
  runner: "local",
  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath,
        captureBackendLogs: true,
        driverProvider: "embedded",
        env: {
          CODEAGENT_WEBVIEW_TEST: "1",
          // A shared WebView2 profile can reuse the installed app's browser/GPU
          // processes, contaminating resource measurements and test isolation.
          ...(process.platform === "win32" ? { WEBVIEW2_USER_DATA_FOLDER: mkdtempSync(resolve(tmpdir(), "codeagent-webview-")) } : {}),
        },
      },
    ],
  ],
  specs: performanceEnabled
    ? ["./tests/webview/performance.spec.ts"]
    : realRuntimeEnabled
      ? ["./tests/webview/real-codex-runtime.spec.ts"]
      : ["./tests/webview/critical-flows.spec.ts", "./tests/webview/clipboard.spec.ts"],
  waitforTimeout: 10_000,
};
