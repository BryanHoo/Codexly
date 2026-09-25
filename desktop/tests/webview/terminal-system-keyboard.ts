import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { windowsTerminalNative } from "./windows-terminal-native.js";

export async function postTerminalSystemText(text: string, delayMicroseconds = 10000, enter = true): Promise<void> {
  if (process.platform === "win32") {
    await windowsTerminalNative("keys", text, delayMicroseconds, enter);
    return;
  }
  const executable = resolve("src-tauri/target/aarch64-apple-darwin", process.env.CODEAGENT_WEBVIEW_RELEASE === "1" ? "release" : "debug", "codeagent");
  // 精确匹配测试二进制，系统事件只投递到该 PID；不触碰其他前台应用。
  await promisify(execFile)("swift", ["-e", `
    import AppKit
    import CoreGraphics
    guard CGPreflightPostEventAccess() else { exit(3) }
    guard let app = NSWorkspace.shared.runningApplications.first(where: { $0.executableURL?.path == CommandLine.arguments[1] }) else { exit(2) }
    for character in CommandLine.arguments[2] {
      let units = Array(String(character).utf16)
      for down in [true, false] {
        let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down)!
        units.withUnsafeBufferPointer { event.keyboardSetUnicodeString(stringLength: units.count, unicodeString: $0.baseAddress!) }
        event.postToPid(app.processIdentifier)
      }
      usleep(UInt32(CommandLine.arguments[3])!)
    }
    if CommandLine.arguments[4] == "true" {
      for down in [true, false] { CGEvent(keyboardEventSource: nil, virtualKey: 36, keyDown: down)!.postToPid(app.processIdentifier) }
    }
  `, executable, text, String(delayMicroseconds), String(enter)]);
}
