import { expect, it } from "vitest";
import { joinHostPath } from "./host-path.js";

it.each([
  ["/srv/project\\", "docs/a.txt", "/srv/project\\/docs/a.txt"],
  ["/srv/project", "docs/a\\b.txt", "/srv/project/docs/a\\b.txt"],
  ["C:\\work/project", "docs/a.txt", "C:\\work/project\\docs\\a.txt"],
  ["C:\\", "docs/a.txt", "C:\\docs\\a.txt"],
  ["\\\\host\\share", "docs/a.txt", "\\\\host\\share\\docs\\a.txt"],
  ["/", "docs/a.txt", "/docs/a.txt"],
])("两端以宿主根目录 %s 拼接路径，不依赖浏览器系统", (rootPath, path, expected) => {
  expect(joinHostPath(rootPath, path)).toBe(expected);
});
