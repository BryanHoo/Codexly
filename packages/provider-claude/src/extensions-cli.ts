import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export type ClaudeExtensionCommand = (args: readonly string[], cwd: string) => Promise<string>;

/** 直接运行同版本官方 CLI，不经过 shell；桌面端注入随应用分发的执行文件。 */
export function claudeExtensionCommand(executable?: string): ClaudeExtensionCommand {
  return async (args, cwd) => {
    // Windows 临时目录可能是 RUNNER~1 等短路径；先展开，确保 CLI 保存的项目键与服务读取一致。
    const canonicalCwd = await realpath(cwd);
    return new Promise((resolve, reject) => {
      const cli = executable ?? resolveNativeCli();
      const script = cli.endsWith(".js");
      const { CLAUDECODE: _nested, ...inherited } = process.env;
      const env = {
        ...inherited,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        DISABLE_AUTOUPDATER: "1",
      };
      const child = execFile(
        script ? process.execPath : cli,
        script ? [cli, ...args] : [...args],
        {
          cwd: canonicalCwd,
          env,
          timeout: 35_000,
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
        },
        (error, stdout) => {
          // 不将 stderr、命令参数或原生配置回传前端，防止意外泄漏令牌。
          if (error)
            reject(
              new Error(
                `Claude CLI 操作失败（${String(error.code ?? "unknown")}），请检查运行时及官方插件配置`,
              ),
            );
          else resolve(stdout);
        },
      );
      // 管理命令没有交互终端；关闭输入，遇到交互要求时由 CLI 明确失败。
      child.stdin?.end();
    });
  };
}

/** 独立桌面宿主不需要 node_modules；只有 Web 默认驱动才解析 SDK 的平台包。 */
function resolveNativeCli(): string {
  const require = createRequire(
    createRequire(import.meta.url).resolve("@anthropic-ai/claude-agent-sdk"),
  );
  const report =
    process.platform === "linux"
      ? (process.report.getReport() as { header?: { glibcVersionRuntime?: string } })
      : undefined;
  const musl = process.platform === "linux" && !report?.header?.glibcVersionRuntime;
  const packageName = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}${musl ? "-musl" : ""}`;
  return join(
    dirname(require.resolve(`${packageName}/package.json`)),
    process.platform === "win32" ? "claude.exe" : "claude",
  );
}
