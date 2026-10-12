import { expect, it } from "vitest";
import { isVisibleProjectPath } from "./project-file-visibility.js";

it.each([
  ".DS_Store",
  "nested/.DS_Store",
  "C:\\project\\Thumbs.db",
  "dir/DESKTOP.INI",
  "src/._main.ts",
  "__MACOSX/src/main.ts",
  ".Trashes/123/file.txt",
  ".Spotlight-V100/index",
])("隐藏系统元数据：%s", (path) => {
  expect(isVisibleProjectPath(path)).toBe(false);
});
it.each([
  ".gitignore",
  ".env",
  ".github/workflows/ci.yml",
  "src/main.ts",
  "docs/DS_Store.md",
  "src/desktop.ini.ts",
])("保留项目文件：%s", (path) => {
  expect(isVisibleProjectPath(path)).toBe(true);
});
