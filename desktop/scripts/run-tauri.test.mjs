import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  resolveTauriArguments,
  resolveTauriEnvironment,
} from "./tauri-build-constraints.mjs";

void test("the project Tauri command should enforce platform build constraints", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));

  assert.equal(packageJson.scripts.tauri, "node scripts/run-tauri.mjs");
});

void test("native test launchers should use the configured Tauri binary name", async () => {
  const config = JSON.parse(
    await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  );
  const launchers = [
    ["../wdio.conf.ts", [`.exe`, ""]],
    ["../tests/webview/windows-terminal-native.ts", [`.exe`]],
    ["../tests/webview/terminal-native-dialog.ts", [""]],
    ["../tests/webview/terminal-system-keyboard.ts", [""]],
    ["../tests/webview/terminal-ui.spec.ts", [""]],
    ["../benchmarks/terminal/terminal-native.spec.ts", [""]],
  ];

  for (const [path, extensions] of launchers) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    for (const extension of extensions) {
      assert.ok(source.includes(`"${config.mainBinaryName}${extension}"`), path);
    }
  }

  const windowsNative = await readFile(
    new URL("../tests/webview/windows-terminal-native.ps1", import.meta.url), "utf8",
  );
  assert.ok(windowsNative.includes(`Get-Process ${config.mainBinaryName} `));
  assert.ok(windowsNative.includes(`-eq '${config.productName}'`));
});

void test("the main window should allow SPA navigation event subscriptions", async () => {
  const capability = JSON.parse(
    await readFile(new URL("../src-tauri/capabilities/default.json", import.meta.url)),
  );

  assert.ok(capability.permissions.includes("core:event:allow-listen"));
  assert.ok(capability.permissions.includes("core:event:allow-unlisten"));
});

void test("macOS builds should default to the Apple Silicon target", () => {
  assert.deepEqual(resolveTauriArguments(["build", "--no-sign"], "darwin", "arm64"), [
    "build",
    "--target",
    "aarch64-apple-darwin",
    "--no-sign",
  ]);
});

void test("macOS release builds should disable Cargo strip for proc-macro libraries", () => {
  assert.deepEqual(resolveTauriEnvironment(["build"], "darwin", "modern"), {
    CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_STRIP: "false",
    MACOSX_DEPLOYMENT_TARGET: "14.5",
  });
});

void test("macOS builds should preserve an explicit Intel target", () => {
  const args = ["build", "-t", "x86_64-apple-darwin"];
  assert.deepEqual(resolveTauriArguments(args, "darwin", "arm64"), args);
});

void test("Legacy builds should select Intel and append the isolated configuration", () => {
  assert.deepEqual(resolveTauriArguments(["build"], "darwin", "arm64", "legacy"), [
    "build", "--target", "x86_64-apple-darwin",
    "--config", "src-tauri/tauri.macos-legacy.conf.json",
  ]);
});

void test("Legacy builds should reject unsupported platforms and targets", () => {
  assert.throws(() => resolveTauriArguments(["build"], "linux", "x64", "legacy"), /Legacy/);
  assert.throws(() => resolveTauriArguments(
    ["build", "--target=aarch64-apple-darwin"], "darwin", "arm64", "legacy",
  ), /Legacy/);
  assert.throws(() => resolveTauriArguments(["build"], "darwin", "arm64", "typo"), /profile/);
});

void test("Intel hosts should build an Intel app by default", () => {
  assert.deepEqual(resolveTauriArguments(["build"], "darwin", "x64"), [
    "build", "--target", "x86_64-apple-darwin",
  ]);
});

void test("macOS builds should reject targets without a matching runtime", () => {
  assert.throws(
    () => resolveTauriArguments(["build", "-t", "universal-apple-darwin"], "darwin"),
    /Unsupported macOS target/,
  );
});

void test("Windows builds should preserve an explicit updater bundle", () => {
  assert.deepEqual(resolveTauriArguments(["build", "--bundles", "nsis", "--no-sign"], "win32"), [
    "build",
    "--bundles",
    "nsis",
    "--no-sign",
  ]);
});

void test("Windows local builds should still default to an unpackaged executable", () => {
  assert.deepEqual(resolveTauriArguments(["build", "--no-sign"], "win32"), [
    "build",
    "--no-bundle",
    "--no-sign",
  ]);
});

void test("Windows releases should publish portable and updater NSIS artifacts", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );

  assert.match(
    workflow,
    /- name: Windows x64 Portable[\s\S]*?args: --no-bundle --no-sign --ci[\s\S]*?uploadPlainBinary: true[\s\S]*?uploadUpdaterArtifacts: false/,
  );
  assert.match(workflow, /releaseAssetNamePattern: "\[name\]_\[version\]_\[arch\]_portable\[ext\]"/);
  assert.match(
    workflow,
    /- name: Windows x64 NSIS[\s\S]*?args: --bundles nsis --ci[\s\S]*?uploadPlainBinary: false[\s\S]*?uploadUpdaterArtifacts: true/,
  );
});

void test("bundled releases should publish signed updater artifacts", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY: \$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY \}\}/);
  assert.match(workflow, /uploadUpdaterJson: \$\{\{ matrix\.uploadUpdaterArtifacts \}\}/);
  assert.match(workflow, /uploadUpdaterSignatures: \$\{\{ matrix\.uploadUpdaterArtifacts \}\}/);
  assert.ok(workflow.includes("prerelease: ${{ contains(steps.build-version.outputs.version, '-') }}"));
});

void test("Tauri should use signed GitHub release metadata", async () => {
  const config = JSON.parse(
    await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  );

  assert.equal(config.bundle.createUpdaterArtifacts, true);
  assert.match(config.plugins.updater.pubkey, /^[A-Za-z0-9+/]+=*$/);
  assert.deepEqual(config.plugins.updater.endpoints, [
    "https://github.com/BryanHoo/Codexly/releases/latest/download/latest.json",
  ]);
});

void test("Windows should verify Codex through the app instead of the Tauri test harness", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/webview.yml", import.meta.url),
    "utf8",
  );

  // Tauri 的 Windows 测试进程存在装载器问题，产品应用链路仍必须保留真实运行时覆盖。
  assert.match(
    workflow,
    /name: Run real Codex lifecycle test\n\s+if: matrix\.platform != 'windows-latest'/,
  );
  assert.match(
    workflow,
    /name: Run real Codex WebView chain\n\s+if: matrix\.platform != 'ubuntu-24\.04'/,
  );
});

void test("native WebView CI should exercise private installation without global Codex", async () => {
  const [workflow, processSource] = await Promise.all([
    readFile(new URL("../.github/workflows/webview.yml", import.meta.url), "utf8"),
    readFile(
      new URL("../src-tauri/src/infrastructure/codex/process.rs", import.meta.url),
      "utf8",
    ),
  ]);
  const supportedVersion = processSource.match(
    /SUPPORTED_CODEX_VERSION: &str = "(\d+\.\d+\.\d+)"/,
  )?.[1];

  assert.ok(supportedVersion, "Rust must declare a supported Codex runtime version");
  assert.doesNotMatch(workflow, /npm install --global @openai\/codex/);
  assert.doesNotMatch(workflow, /run: codex --version/);
  assert.match(workflow, /private_codex_should_install_and_complete_real_app_server_lifecycle/);
});

void test("non-macOS commands should remain unchanged", () => {
  const argumentsList = ["build", "--no-sign"];

  assert.deepEqual(resolveTauriArguments(argumentsList, "linux"), argumentsList);
});
