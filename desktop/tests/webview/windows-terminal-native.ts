import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function windowsTerminalNative(action: "activate" | "keys" | "request" | "cancel" | "confirm" | "inspect", text = "", delayMicroseconds = 10000, enter = false): Promise<Record<string, unknown>> {
  const executable = resolve("src-tauri/target", process.env.CODEAGENT_WEBVIEW_RELEASE === "1" ? "release" : "debug", "codeagent.exe");
  const { stdout } = await promisify(execFile)("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", fileURLToPath(new URL("./windows-terminal-native.ps1", import.meta.url)),
    "-Executable", executable, "-Action", action, "-TextBase64", Buffer.from(text).toString("base64"),
    "-DelayMilliseconds", String(Math.ceil(delayMicroseconds / 1000)), "-Enter", String(enter),
  ], { timeout: Math.max(15000, text.length * Math.ceil(delayMicroseconds / 1000) + 10000), windowsHide: true, maxBuffer: 16384 });
  return JSON.parse(stdout.trim()) as Record<string, unknown>;
}
