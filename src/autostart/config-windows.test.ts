import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { writePrivateJson } from "./config.js";

async function withSharingLock(
  durationMs: number,
  check: (path: string, root: string) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "codexly-state-lock-"));
  const path = join(root, "runtime.json");
  await writePrivateJson(path, { phase: "ready" });
  const script = `$ErrorActionPreference='Stop'; $file=[IO.File]::Open('${path.replace(/'/gu, "''")}',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read); try { [Console]::WriteLine('locked'); Start-Sleep -Milliseconds ${String(durationMs)} } finally { $file.Dispose() }`;
  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Lock helper exited: ${String(code)}`));
    });
  });
  // 立即观察辅助进程失败，清理期间的退出也不能产生未处理拒绝。
  void exited.catch(() => undefined);
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.once("data", () => {
        resolve();
      });
      child.once("error", reject);
      child.once("exit", () => {
        reject(new Error("Lock helper exited before acquiring the file"));
      });
    });
    await check(path, root);
  } finally {
    if (child.exitCode === null) child.kill();
    await exited.catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
}

it.runIf(process.platform === "win32")(
  "replaces private state after a temporary Windows sharing lock without removing the old file",
  () =>
    withSharingLock(500, async (path, root) => {
      expect(await readFile(path, "utf8")).toContain('"ready"');
      await expect(writePrivateJson(path, { phase: "stopped" })).resolves.toBeUndefined();
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ phase: "stopped" });
      expect(await readdir(root)).toEqual(["runtime.json"]);
    }),
  // Windows CI 的 PowerShell 冷启动也计入测试耗时，重试上限由生产代码单独保证。
  15_000,
);

it.runIf(process.platform === "win32")(
  "bounds retries for a persistent Windows sharing lock and preserves the previous state",
  () =>
    withSharingLock(5_000, async (path, root) => {
      await expect(writePrivateJson(path, { phase: "stopped" })).rejects.toMatchObject({
        code: "EPERM",
      });
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ phase: "ready" });
      expect(await readdir(root)).toEqual(["runtime.json"]);
    }),
  15_000,
);
