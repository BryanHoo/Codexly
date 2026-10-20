import { join } from "node:path";
import { expect, it } from "vitest";
import { appStorageDirectory, legacyStorageDirectories } from "./app-storage-paths.js";

it("uses one application home independently of the engine", () => {
  expect(appStorageDirectory("/home/user")).toBe(join("/home/user", ".codexly"));
});

it.each([
  ["darwin", "/Users/用户", {}, "/Users/用户/Library/Application Support/com.codexly.desktop"],
  ["linux", "/home/user", {}, "/home/user/.local/share/com.codexly.desktop"],
  ["linux", "/home/user", { XDG_DATA_HOME: "/data" }, "/data/com.codexly.desktop"],
  ["win32", "C:\\Users\\用户", {}, "C:\\Users\\用户\\AppData\\Roaming\\com.codexly.desktop"],
  ["win32", "C:\\Users\\用户", { APPDATA: "D:\\Roaming" }, "D:\\Roaming\\com.codexly.desktop"],
] as const)("discovers %s legacy application data", (platform, home, env, expected) => {
  const codex = platform === "win32" ? "D:\\Codex" : "/custom/codex";
  expect(legacyStorageDirectories(codex, home, platform, env)).toContain(expected);
});
