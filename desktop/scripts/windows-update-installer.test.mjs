import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, chmod, copyFile, mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const hooks = fileURLToPath(new URL("../src-tauri/windows/installer-hooks.nsh", import.meta.url));

void test("Windows bundles include the runtime cleanup hooks for the configured executable", async () => {
  const configUrl = new URL("../src-tauri/tauri.conf.json", import.meta.url);
  const config = JSON.parse(await readFile(configUrl, "utf8"));
  assert.equal(fileURLToPath(new URL(config.bundle.windows.nsis.installerHooks, configUrl)), hooks);
  assert.equal(config.mainBinaryName, "codexly", "the early updater wait must match the application binary");
  await access(hooks);
});

async function run(program, args, options = {}) {
  const child = spawn(program, args, { stdio: "pipe", windowsHide: true, ...options });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  const timer = setTimeout(() => child.kill(), 20_000);
  try {
    const [code] = await once(child, "exit");
    assert.equal(code, 0, output);
  } finally {
    clearTimeout(timer);
  }
}

async function runningAgent(directory) {
  const binary = join(directory, "runtime", "codex", "bin", "codex.exe");
  await mkdir(dirname(binary), { recursive: true });
  await copyFile(join(process.env.SystemRoot, "System32", "PING.EXE"), binary);
  const child = spawn(binary, ["-t", "127.0.0.1"], { stdio: "ignore", windowsHide: true });
  await once(child, "spawn");
  return { binary, child };
}

void test("Windows updates and uninstalls release legacy runtimes only in their own installation", {
  skip: process.platform !== "win32",
  timeout: 60_000,
}, async (context) => {
  const nsis = process.env.CODEXLY_NSIS_PATH
    ?? join(process.env.LOCALAPPDATA, "tauri", "NSIS", "makensis.exe");
  try { await access(nsis); } catch {
    context.skip("NSIS is unavailable; build a Windows installer or set CODEXLY_NSIS_PATH first");
    return;
  }
  // Spaces and Unicode exercise the same full-path matching used in real installs.
  const root = await mkdtemp(join(tmpdir(), "Codexly 更新测试 "));
  const installation = join(root, "installed");
  const other = await runningAgent(join(root, "other installation"));
  let agent;
  try {
    agent = await runningAgent(installation);
    await assert.rejects(open(agent.binary, "r+"), { code: "EBUSY" });
    const sentinel = join(installation, "user-data.txt");
    await writeFile(sentinel, "preserve user data");
    await writeFile(join(root, "payload"), "updated runtime");
    const script = join(root, "installer.nsi");
    const installer = join(root, "setup.exe");
    await writeFile(script, `\uFEFFUnicode true
RequestExecutionLevel user
Name "Codexly Update Regression"
OutFile "${installer}"
InstallDir "${installation}"
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!define MAINBINARYNAME "codexly"
!define PRODUCTNAME "Codexly Update Regression"
Var UpdateMode
; The main application has already exited; retain the Tauri macro interface.
!macro CheckIfAppIsRunning executablePath productName
!macroend
!include "${hooks}"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Section
  !insertmacro NSIS_HOOK_PREINSTALL
  SetOutPath "$INSTDIR\\runtime\\codex\\bin"
  File "/oname=codex.exe" "${join(root, "payload")}"
  WriteUninstaller "$INSTDIR\\uninstall.exe"
SectionEnd
Section Uninstall
  !insertmacro NSIS_HOOK_PREUNINSTALL
  Delete "$INSTDIR\\runtime\\codex\\bin\\codex.exe"
SectionEnd
`);
    await run(nsis, ["/V2", script]);
    await run(installer, ["/S"]);
    assert.equal(await readFile(agent.binary, "utf8"), "updated runtime");
    assert.equal(await readFile(sentinel, "utf8"), "preserve user data");
    assert.equal(other.child.exitCode, null);
    agent = await runningAgent(installation);
    await chmod(agent.binary, 0o444);
    await assert.rejects(run(installer, ["/S"]), { code: "ERR_ASSERTION" });
    await chmod(agent.binary, 0o666);
    assert.equal((await readFile(agent.binary)).subarray(0, 2).toString(), "MZ");
    assert.equal(await readFile(sentinel, "utf8"), "preserve user data");
    assert.equal(other.child.exitCode, null);
    agent = await runningAgent(installation);
    // _?= keeps NSIS in the original process so the test awaits the real uninstall.
    await run(join(installation, "uninstall.exe"), ["/S", `_?=${installation}`], {
      windowsVerbatimArguments: true,
    });
    await assert.rejects(access(agent.binary), { code: "ENOENT" });
    assert.equal(await readFile(sentinel, "utf8"), "preserve user data");
    assert.equal(other.child.exitCode, null);
  } finally {
    for (const child of [agent?.child, other.child]) {
      if (child && child.exitCode === null) {
        child.kill();
        await Promise.race([once(child, "exit"), delay(2000)]);
      }
    }
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + "\\"));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
