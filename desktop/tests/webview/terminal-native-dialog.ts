import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { windowsTerminalNative } from "./windows-terminal-native.js";

const windowsActions: Record<string, unknown>[] = [];

export async function terminalNativeDialog(action: "request" | "cancel" | "confirm"): Promise<void> {
  if (process.platform === "win32") {
    const result = await windowsTerminalNative(action, action === "cancel" ? "取消" : action === "confirm" ? "结束并关闭" : "");
    windowsActions.push(result);
    await mkdir("artifacts/terminal", { recursive: true });
    await writeFile("artifacts/terminal/windows-native-dialog.json", JSON.stringify({ measuredAt: new Date().toISOString(), actions: windowsActions }, null, 2));
    return;
  }
  const executable = resolve("src-tauri/target/aarch64-apple-darwin", process.env.CODEAGENT_WEBVIEW_RELEASE === "1" ? "release" : "debug", "codeagent");
  // 只访问测试 PID 的原生窗口树，并跳过 WebView 内容，避免把网页按钮当作系统提示。
  await promisify(execFile)("swift", ["-e", `
    import AppKit
    import ApplicationServices
    guard AXIsProcessTrusted() else { exit(3) }
    guard let app = NSWorkspace.shared.runningApplications.first(where: { $0.executableURL?.path == CommandLine.arguments[1] }) else { exit(2) }
    let application = AXUIElementCreateApplication(app.processIdentifier)
    func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
      var value: CFTypeRef?
      guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
      return value
    }
    func button(_ element: AXUIElement, _ title: String, _ depth: Int) -> AXUIElement? {
      if depth > 8 { return nil }
      let role = attribute(element, kAXRoleAttribute) as? String
      if role == "AXWebArea" { return nil }
      let name = (attribute(element, kAXTitleAttribute) as? String) ?? (attribute(element, kAXDescriptionAttribute) as? String)
      if role == kAXButtonRole && name == title { return element }
      let children = (attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? []) + (attribute(element, "AXSheets") as? [AXUIElement] ?? [])
      for child in children {
        if let found = button(child, title, depth + 1) { return found }
      }
      return nil
    }
    let action = CommandLine.arguments[2]
    for _ in 0..<100 {
      let windows = attribute(application, kAXWindowsAttribute) as? [AXUIElement] ?? []
      for window in windows {
        var target: AXUIElement?
        if action == "request" {
          if let close = attribute(window, kAXCloseButtonAttribute) { target = (close as! AXUIElement) }
        } else { target = button(window, action == "cancel" ? "取消" : "结束并关闭", 0) }
        if let target = target {
          guard AXUIElementPerformAction(target, kAXPressAction as CFString) == .success else { exit(4) }
          exit(0)
        }
      }
      usleep(50000)
    }
    func labels(_ element: AXUIElement, _ depth: Int) -> [String] {
      if depth > 8 || attribute(element, kAXRoleAttribute) as? String == "AXWebArea" { return [] }
      var result: [String] = []
      if attribute(element, kAXRoleAttribute) as? String == kAXButtonRole {
        result.append((attribute(element, kAXTitleAttribute) as? String) ?? (attribute(element, kAXDescriptionAttribute) as? String) ?? "unnamed")
      }
      for child in attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] { result += labels(child, depth + 1) }
      return result
    }
    print("Native button labels:", Array(labels(application, 0).prefix(16)))
    exit(5)
  `, executable, action]).catch((error: unknown) => {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    throw new Error(`Native dialog ${action} failed (${failure.code}): ${failure.stdout ?? ""} ${failure.stderr ?? ""}`);
  });
}
