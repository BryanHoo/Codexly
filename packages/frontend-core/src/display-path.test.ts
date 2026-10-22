import { describe, expect, it } from "vitest";
import { formatDisplayPath } from "./display-path.js";

describe("formatDisplayPath", () => {
  it.each([
    [String.raw`\\?\C:\workspace\project`, String.raw`C:\workspace\project`],
    ["\\\\?\\D:\\", "D:\\"],
    [String.raw`\\?\UNC\server\share\project`, String.raw`\\server\share\project`],
    [String.raw`\\?\unc\server\share`, String.raw`\\server\share`],
  ])("displays %s as %s", (path, expected) => {
    expect(formatDisplayPath(path)).toBe(expected);
  });

  it.each([
    "",
    String.raw`C:\workspace\project`,
    String.raw`\\server\share`,
    "/home/user/project",
    "src/main.ts",
    String.raw`/tmp/\\?\example`,
    String.raw`\\.\pipe\codex`,
    String.raw`\\?\Volume{123}\file`,
  ])("preserves paths without a DOS or UNC extended prefix: %s", (path) => {
    expect(formatDisplayPath(path)).toBe(path);
  });

  it("preserves missing optional paths", () => {
    expect(formatDisplayPath(undefined)).toBeUndefined();
    expect(formatDisplayPath(null)).toBeNull();
  });
});
