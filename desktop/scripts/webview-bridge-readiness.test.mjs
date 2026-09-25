import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { waitForWebviewBridge } from "../tests/webview/bridge-readiness.mjs";
import "./webview-timeouts.test.mjs";

void test("WebView bridge readiness retries transient startup failures", async () => {
  let attempts = 0;

  await waitForWebviewBridge(
    async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("WebView test bridge is unavailable");
    },
    { intervalMs: 0, timeoutMs: 100 },
  );

  assert.equal(attempts, 3);
});

void test("WebView bridge readiness reports the last startup failure on timeout", async () => {
  const startupError = new Error("WebView test bridge is unavailable");

  await assert.rejects(
    waitForWebviewBridge(async () => Promise.reject(startupError), {
      intervalMs: 0,
      timeoutMs: 0,
    }),
    (error) => error === startupError,
  );
});

void test("Native WebView workflow installs the Ubuntu WebKit driver", async () => {
  const workflow = await readFile(new URL("../.github/workflows/webview.yml", import.meta.url), "utf8");

  assert.match(workflow, /\bwebkit2gtk-driver\b/u);
});

void test("Native WebView workflow builds the test application after Cargo lifecycle tests", async () => {
  const workflow = await readFile(new URL("../.github/workflows/webview.yml", import.meta.url), "utf8");
  const lifecycleTestAt = workflow.indexOf("- name: Run real Codex lifecycle test");
  const webviewBuildAt = workflow.indexOf("- name: Build native WebView test application");
  const webviewTestAt = workflow.indexOf("- name: Run native WebView tests");

  assert.notEqual(lifecycleTestAt, -1);
  assert.notEqual(webviewBuildAt, -1);
  assert.notEqual(webviewTestAt, -1);
  assert.ok(
    lifecycleTestAt < webviewBuildAt && webviewBuildAt < webviewTestAt,
    "Cargo tests must not overwrite the configured WebView test application",
  );
});

void test("WebView bridge is published before the WDIO plugin import settles", async () => {
  const bootstrap = await readFile(
    new URL("../src/webview-test-bootstrap.ts", import.meta.url),
    "utf8",
  );
  const bridgePublishedAt = bootstrap.indexOf(
    "window.__CODEAGENT_WEBVIEW_TEST_BRIDGE__ = bridge;",
  );
  const pluginImportAt = bootstrap.indexOf('await import("@wdio/tauri-plugin");');

  assert.notEqual(bridgePublishedAt, -1);
  assert.notEqual(pluginImportAt, -1);
  assert.ok(
    bridgePublishedAt < pluginImportAt,
    "WebKitGTK must observe the bridge without waiting for the WDIO module boundary",
  );
});
