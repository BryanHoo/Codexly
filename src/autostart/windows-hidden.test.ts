import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { createConfig, getAutostartPaths, writePrivateFile } from "./config.js";
import { createPlatformAdapter, execute } from "./platform.js";

const exec = promisify(execFile);
async function powershell(script: string): Promise<string> {
  const result = await exec(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    { windowsHide: true, timeout: 15_000 },
  );
  return result.stdout.trim();
}
const literal = (value: string): string => `'${value.replace(/'/gu, "''")}'`;

it.runIf(process.platform === "win32")(
  "runs a real scheduled task without a visible console and preserves argv and exit status",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "codexly-hidden-"));
    const folder = join(root, "中文 & %TEMP% folder");
    await mkdir(folder);
    const cli = join(folder, "probe.cjs");
    const marker = join(root, "started.json");
    const stop = join(root, "stop");
    const taskName = `Codexly hidden test ${String(process.pid)}`;
    let pid: number | undefined;
    let registered = false;
    try {
      const sid = await powershell(
        "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
      );
      const paths = getAutostartPaths("win32", root, { LOCALAPPDATA: root });
      const config = createConfig(
        {},
        { node: process.execPath, cli, home: root, cwd: folder, environment: {} },
      );
      await writePrivateFile(
        cli,
        `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({pid:process.pid,argv:process.argv.slice(2),cwd:process.cwd()})); const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(stop)})){clearInterval(timer);process.exitCode=17;}},50);`,
      );
      await createPlatformAdapter("win32", paths, {
        execute: async (command, args) =>
          command === "powershell.exe"
            ? { code: 0, stdout: sid, stderr: "" }
            : args.includes("/Create")
              ? { code: 0, stdout: "", stderr: "" }
              : execute(command, args),
      }).install(config);
      await expect(readFile(join(paths.root, "launch.js"))).resolves.toBeInstanceOf(Buffer);
      const xml = (await readFile(paths.registration))
        .subarray(2)
        .toString("utf16le")
        .replace(/<Triggers>.*?<\/Triggers>/su, "<Triggers />");
      await writePrivateFile(paths.registration, Buffer.from(`\uFEFF${xml}`, "utf16le"));
      await exec("schtasks.exe", ["/Create", "/TN", taskName, "/XML", paths.registration, "/F"], {
        windowsHide: true,
      });
      registered = true;
      await exec("schtasks.exe", ["/Run", "/TN", taskName], { windowsHide: true });
      await expect
        .poll(
          async () => {
            try {
              return JSON.parse(await readFile(marker, "utf8")) as unknown;
            } catch {
              return undefined;
            }
          },
          { timeout: 15_000 },
        )
        .toBeDefined();
      const started = JSON.parse(await readFile(marker, "utf8")) as {
        pid: number;
        argv: string[];
        cwd: string;
      };
      pid = started.pid;
      expect(started.argv).toEqual(["autostart", "run", "--config", paths.config]);
      expect(started.cwd).toBe(root);
      const consoleState = await powershell(
        `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ConsoleProbe { [DllImport("kernel32.dll")] public static extern bool AttachConsole(uint pid); [DllImport("kernel32.dll")] public static extern bool FreeConsole(); [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd); }'; [ConsoleProbe]::FreeConsole() | Out-Null; if (-not [ConsoleProbe]::AttachConsole(${String(pid)})) { throw 'Cannot inspect child console' }; try { [ConsoleProbe]::IsWindowVisible([ConsoleProbe]::GetConsoleWindow()) } finally { [ConsoleProbe]::FreeConsole() | Out-Null }`,
      );
      expect(consoleState).toBe("False");
      await writePrivateFile(stop, "stop");
      await expect
        .poll(
          async () =>
            Number(
              await powershell(
                `$s=New-Object -ComObject 'Schedule.Service'; $s.Connect(); $t=$s.GetFolder('\\').GetTask(${literal(taskName)}); if ($t.State -ne 4) { $t.LastTaskResult } else { -1 }`,
              ),
            ),
          { timeout: 15_000, interval: 200 },
        )
        .toBe(17);
      pid = undefined;
    } finally {
      if (pid) {
        try {
          process.kill(pid);
        } catch {
          // The child may have exited before cleanup reached it.
        }
      }
      if (registered) {
        await exec("schtasks.exe", ["/End", "/TN", taskName], { windowsHide: true }).catch(
          () => undefined,
        );
        await exec("schtasks.exe", ["/Delete", "/TN", taskName, "/F"], { windowsHide: true });
      }
      await delay(100);
      await rm(root, { recursive: true, force: true });
    }
  },
);
