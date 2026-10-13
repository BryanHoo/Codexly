import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { browser, expect } from "@wdio/globals";
import { waitForWebviewBridge } from "./bridge-readiness.mjs";

const execFileAsync = promisify(execFile);
const keys = [
  "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
  "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run",
];
const names = ["Codexly", "codeagent"];
type Entry = { key: string; name: string; kind: string; value: string | number[] };
let original: Entry[] | undefined;

async function powershell(script: string): Promise<string> {
  const result = await execFileAsync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-EncodedCommand",
    Buffer.from("$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); " + script, "utf16le").toString("base64"),
  ], { encoding: "utf8", windowsHide: true });
  return result.stdout.trim();
}

async function entries(): Promise<Entry[]> {
  const script = `$items=@(); foreach($path in @('${keys.join("','")}')) {
    $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($path);
    if($null -eq $key){continue}; try { foreach($name in @('${names.join("','")}')) {
      if($key.GetValueNames() -contains $name){ $items+=@{key=$path;name=$name;kind=$key.GetValueKind($name).ToString();value=$key.GetValue($name)} }
    }} finally {$key.Dispose()}
  }; ConvertTo-Json -InputObject @($items) -Compress`;
  return JSON.parse(await powershell(script)) as Entry[];
}

async function restoreEntries(): Promise<void> {
  if (original === undefined) return;
  const encoded = Buffer.from(JSON.stringify(original), "utf8").toString("base64");
  await powershell(`foreach($path in @('${keys.join("','")}')) {
    $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($path,$true);
    if($null -eq $key){continue}; try { foreach($name in @('${names.join("','")}')) {$key.DeleteValue($name,$false)} } finally {$key.Dispose()}
  }; $items=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')));
  foreach($item in $items) {
    $key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($item.key);
    try { $value=$item.value; if($item.kind -eq 'Binary'){$value=[byte[]]$value}; $key.SetValue($item.name,$value,[Enum]::Parse([Microsoft.Win32.RegistryValueKind],$item.kind)) } finally {$key.Dispose()}
  }`);
}

async function invoke<T>(command: string): Promise<T> {
  return await browser.tauri.execute(({ core }, name) => core.invoke(name), command) as T;
}

const describeWindows = process.platform === "win32" ? describe : describe.skip;
describeWindows("Windows native login startup", () => {
  before(async () => {
    original = await entries();
    await waitForWebviewBridge(async () => {
      if (!await browser.execute(() => window.__CODEAGENT_WEBVIEW_TEST_BRIDGE__ !== undefined)) {
        throw new Error("WebView bridge is unavailable");
      }
    });
    if (await browser.execute(() => window.__CODEAGENT_WEBVIEW_TEST_READY__ === true)) {
      await browser.refresh();
      await waitForWebviewBridge(async () => {
        if (!await browser.execute(() => window.__CODEAGENT_WEBVIEW_TEST_BRIDGE__ !== undefined && window.__CODEAGENT_WEBVIEW_TEST_READY__ !== true)) {
          throw new Error("Fresh WebView bridge is unavailable");
        }
      });
    }
    // Every request uses actual Tauri IPC and the local Codex runtime in this suite.
    await browser.execute(() => {
      delete window.__CODEAGENT_WEBVIEW_TEST_INVOKE__;
      window.__CODEAGENT_WEBVIEW_TEST_READY__ = true;
    });
  });

  after(async () => {
    await restoreEntries();
    expect(await entries()).toEqual(original);
  });

  it("enables the real registry entry and quotes an executable path containing spaces", async () => {
    await invoke("enable_autostart");
    expect(await invoke("plugin:autostart|is_enabled")).toBe(true);
    const entry = (await entries()).find((item) => item.key === keys[0]);
    expect(entry).toBeDefined();
    const command = String(entry!.value).trim();
    expect(command).toMatch(/^"[^"\r\n]+\.exe"$/u);
  });

  it("reads external Windows startup disablement and re-enables it", async () => {
    const entry = (await entries()).find((item) => item.key === keys[0]);
    if (entry === undefined) throw new Error("Native startup entry is missing");
    await powershell(`$key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('${keys[1]}');
      try {$key.SetValue('${entry.name}',[byte[]](3,0,0,0,1,0,0,0,0,0,0,0),[Microsoft.Win32.RegistryValueKind]::Binary)} finally {$key.Dispose()}`);
    expect(await invoke("plugin:autostart|is_enabled")).toBe(false);
    await invoke("enable_autostart");
    expect(await invoke("plugin:autostart|is_enabled")).toBe(true);
  });

  it("removes the native startup entry when disabled", async () => {
    await invoke("plugin:autostart|disable");
    expect(await invoke("plugin:autostart|is_enabled")).toBe(false);
    expect((await entries()).filter((item) => item.key === keys[0])).toHaveLength(0);
  });
});
