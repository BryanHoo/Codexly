import type { GitCommandExecutor } from "./git-command.js";

/** 历史标记与实际推送共用目标解析，避免 pushRemote 与 upstream 不同时标错提交。 */
export async function resolveGitPushTarget(
  root: string,
  branch: string | null,
  remoteNames: readonly string[],
  execute: GitCommandExecutor,
): Promise<Readonly<{ remote: string | null; targetBranch: string | null }>> {
  if (!branch) return { remote: null, targetBranch: null };
  let output = "";
  try {
    // 一次读取有效配置，减少历史分页的进程开销；NUL 分隔避免配置值换行破坏键值边界。
    output = await execute(root, [
      "config",
      "--null",
      "--get-regexp",
      "^(branch\\..*\\.(pushremote|remote|merge)|remote\\.pushdefault|push\\.default)$",
    ]);
  } catch {
    /* 没有匹配配置时 Git 返回 1，按默认推送规则解析。 */
  }
  const values = new Map(
    output.split("\0").flatMap((record) => {
      const separator = record.indexOf("\n");
      return separator < 0
        ? []
        : [[record.slice(0, separator), record.slice(separator + 1)] as const];
    }),
  );
  const configValue = (key: string) => {
    const value = values.get(key)?.trim();
    return value === "" ? null : (value ?? null);
  };
  const pushRemote = configValue(`branch.${branch}.pushremote`);
  const pushDefaultRemote = configValue("remote.pushdefault");
  const branchRemote = configValue(`branch.${branch}.remote`);
  const pushDefault = configValue("push.default");
  const merge = configValue(`branch.${branch}.merge`);
  return {
    remote:
      pushRemote ??
      pushDefaultRemote ??
      branchRemote ??
      (remoteNames.length === 1 ? (remoteNames[0] ?? null) : null),
    targetBranch:
      pushDefault === "upstream" ? (merge?.replace(/^refs\/heads\//u, "") ?? branch) : branch,
  };
}
