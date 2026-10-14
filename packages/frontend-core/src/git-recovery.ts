export type GitFailureKind =
  | "state_changed"
  | "working_changes"
  | "merge_conflicts"
  | "invalid_remote"
  | "authentication"
  | "permission"
  | "remote_updates"
  | "protected_branch"
  | "network"
  | "host_key"
  | "rules"
  | "unknown_result"
  | "unknown";

/** 优先匹配具体拒绝原因；泛化的 failed/rejected 不能覆盖认证和分支规则。 */
export function classifyGitFailure(message: string | null | undefined): GitFailureKind {
  const text = message?.toLowerCase() ?? "";
  if (
    /(?:git|workspace) (?:status|changes|snapshot|state).*changed|head or branch changed|snapshot.?mismatch/u.test(
      text,
    )
  )
    return "state_changed";
  if (
    /commit or set aside working changes|local changes.*overwritten|would be overwritten by merge/u.test(
      text,
    )
  )
    return "working_changes";
  if (
    /resolve and stage all merge conflicts|choose a current merge conflict|complete or cancel.*merge|conflict marker/u.test(
      text,
    )
  )
    return "merge_conflicts";
  if (/invalid remote (?:url|name)|invalid remote url or name/u.test(text)) return "invalid_remote";
  if (/host key verification|remote host identification has changed/u.test(text)) return "host_key";
  if (/protected branch|gh006|changes must be made through a pull request/u.test(text))
    return "protected_branch";
  if (
    /authentication failed|publickey|invalid.*(?:token|password)|could not read username/u.test(
      text,
    )
  )
    return "authentication";
  if (/write access|permission.*denied|not permitted|403|access denied/u.test(text))
    return "permission";
  if (/non-fast-forward|fetch first|tip of your current branch is behind/u.test(text))
    return "remote_updates";
  if (
    /gh013|repository rule violations|pre-receive hook declined|hook declined|push declined/u.test(
      text,
    )
  )
    return "rules";
  if (/timed out|timeout|connection.*(?:reset|closed)|unexpected disconnect/u.test(text))
    return "unknown_result";
  if (
    /could not resolve|couldn't connect|failed to connect|failed to fetch|networkerror|network request failed|econnrefused|network is unreachable|unable to access/u.test(
      text,
    )
  )
    return "network";
  return "unknown";
}
