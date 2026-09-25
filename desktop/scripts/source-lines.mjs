import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const sourceRoots = ["src/", "src-tauri/src/", "src-tauri/native/", "src-tauri/tests/", "scripts/", "tests/", "benchmarks/"];
const sourceExtension = /\.(?:rs|tsx?|jsx?|[cm]js|css|py)$/u;

export function findSourceLineViolations(paths, root = process.cwd()) {
  return paths.filter((path) => sourceExtension.test(path)
    && (sourceRoots.some((prefix) => path.startsWith(prefix)) || !path.includes("/") || path === "src-tauri/build.rs"))
    .flatMap((path) => {
      const absolute = resolve(root, path);
      // Git 删除项和符号链接不属于待检查的源文件内容。
      let metadata;
      try { metadata = lstatSync(absolute); } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
      }
      if (!metadata.isFile()) return [];
      const text = readFileSync(absolute, "utf8");
      const lines = text.length === 0 ? 0 : text.split("\n").length - Number(text.endsWith("\n"));
      return lines > 500 ? [{ path, lines }] : [];
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // 同时检查已跟踪和新增文件，避免提交前遗漏尚未暂存的模块。
  const paths = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  const violations = findSourceLineViolations([...new Set(paths)]);
  for (const { path, lines } of violations) console.error(`${path}: ${lines} lines exceeds 500`);
  if (violations.length > 0) process.exitCode = 1;
  else console.log("Source files satisfy the 500-line limit.");
}
