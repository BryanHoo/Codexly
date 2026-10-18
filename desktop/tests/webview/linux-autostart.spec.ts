import { execFile } from "node:child_process";
import { lstat, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { browser, expect } from "@wdio/globals";
import { connectMockProvider, installWebviewMocks, passthroughNativeCommands, releaseApplicationStartup } from "./mock-runtime.js";

const entryPath = join(homedir(), ".config", "autostart", "Codexly.desktop");
let backupDirectory: string | undefined;
let captured = false;

async function invoke<T>(command: string): Promise<T> {
  return await browser.tauri.execute(({ core }, name) => core.invoke(name), command) as T;
}

const describeLinux = process.platform === "linux" ? describe : describe.skip;
describeLinux("Linux native login startup", () => {
  before(async () => {
    try {
      await lstat(entryPath);
      backupDirectory = await mkdtemp(join(dirname(entryPath), ".codexly-autostart-test-"));
      await rename(entryPath, join(backupDirectory, "original.desktop"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    captured = true;
    await installWebviewMocks();
    await passthroughNativeCommands(["enable_autostart", "plugin:autostart|disable", "plugin:autostart|is_enabled"]);
    await releaseApplicationStartup();
    await connectMockProvider();
    await $("#global-settings-trigger").waitForClickable();
    await $("#global-settings-trigger").click();
  });

  after(async () => {
    if (!captured) return;
    await rm(entryPath, { force: true });
    if (backupDirectory) {
      await rename(join(backupDirectory, "original.desktop"), entryPath);
      await rm(backupDirectory, { recursive: true });
    }
  });

  it("registers a quoted executable path that the actual desktop parser accepts", async () => {
    const toggle = await $('[role="switch"][aria-label="开机启动"]');
    await toggle.waitForClickable();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(await invoke("plugin:autostart|is_enabled")).toBe(true);
    const entry = await readFile(entryPath, "utf8");
    expect(entry).toMatch(/^Exec=(?:\/usr\/bin\/env -- )?"[^\r\n]+"\s*$/mu);
    const result = await promisify(execFile)("desktop-file-validate", [entryPath]);
    expect(result.stderr).toBe("");
  });

  it("removes the actual desktop login entry when disabled", async () => {
    const toggle = await $('[role="switch"][aria-label="开机启动"]');
    await toggle.waitForClickable();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(await invoke("plugin:autostart|is_enabled")).toBe(false);
    await expect(readFile(entryPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
