import type { GitFailureKind } from "./git-recovery.js";
export type GitReceipt = Readonly<{
  head: string | null;
  commitSha: string | null;
  pushStatus: string;
  failureKind: GitFailureKind;
}>;
export const writeGitReceipt = (receipt: GitReceipt): string =>
  JSON.stringify({ version: 1, ...receipt });

/** 回执只保存原因分类和提交身份，不落盘原始日志或远端凭据。 */
export function readGitReceipt(value: string | null, head?: string | null): GitReceipt | null {
  if (!value || value.length > 2048) return null;
  try {
    const data = JSON.parse(value) as Record<string, unknown>;
    const optionalText = (value: unknown) => value === null || typeof value === "string";
    const kinds = [
      "state_changed",
      "working_changes",
      "merge_conflicts",
      "invalid_remote",
      "authentication",
      "permission",
      "remote_updates",
      "protected_branch",
      "network",
      "host_key",
      "rules",
      "unknown_result",
      "unknown",
    ];
    if (
      data["version"] !== 1 ||
      !optionalText(data["head"]) ||
      !optionalText(data["commitSha"]) ||
      typeof data["pushStatus"] !== "string" ||
      !["failed", "not_configured", "not_requested", "pushed", "checked", "updated"].includes(
        data["pushStatus"],
      ) ||
      !kinds.includes(String(data["failureKind"]))
    )
      return null;
    if (head !== undefined && data["head"] !== null && data["head"] !== head) return null;
    return {
      head: data["head"],
      commitSha: data["commitSha"],
      pushStatus: data["pushStatus"],
      failureKind: data["failureKind"] as GitFailureKind,
    };
  } catch {
    return null;
  }
}
