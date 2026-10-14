import type { GitRemoteState, PushProjectCommitsRequest } from "@codexly/protocol";
import { classifyGitFailure, type GitFailureKind } from "./git-recovery.js";

export type GitRemotePrimaryAction =
  "push" | "fetch" | "inspect" | "configure" | "publish" | "integrate" | "branch" | null;
export type GitRemoteFailure = Readonly<{
  kind: GitFailureKind;
  titleKey: string;
  helpKey: string;
  remote: boolean;
}>;
type Input = Readonly<{
  branch: string | null;
  remote?: GitRemoteState | undefined;
  pushStatus: string | null;
  pushError: string | null;
  actionError: string | null;
  failureOperation?:
    NonNullable<PushProjectCommitsRequest["action"]> | "commit" | "generate" | "status" | undefined;
  savedFailureKind?: GitFailureKind | undefined;
  inspecting: boolean;
  hasActions: boolean;
  hasWorkingChanges: boolean;
  commitSha?: string | undefined;
}>;
type Presentation = Readonly<{
  primary: Readonly<{ action: GitRemotePrimaryAction; labelKey: string; disabledReason?: string }>;
  summaryKey: string;
  hintKey?: string;
  failure: GitRemoteFailure | null;
}>;

/** 两端共用下一步优先级；状态描述与操作分别决定，获取进度不会把推送按钮改成别的动作。 */
export function deriveGitRemotePresentation(input: Input): Presentation {
  const { remote } = input;
  const failed = input.pushStatus === "failed" || input.pushStatus === "not_configured";
  const local = ["commit", "generate", "status"].includes(input.failureOperation ?? "");
  const failedOperation = input.failureOperation ?? "status";
  const kind =
    input.actionError || input.pushError
      ? classifyGitFailure(input.actionError ?? input.pushError)
      : (input.savedFailureKind ?? "unknown");
  const failure: GitRemoteFailure | null =
    failed || input.actionError
      ? {
          kind,
          remote: !local,
          titleKey: local ? `commit.${failedOperation}Failed` : `commit.failure_${kind}`,
          helpKey:
            local && kind === "unknown"
              ? `commit.${failedOperation}FailedHelp`
              : `commit.fix_${kind}`,
        }
      : null;
  const primary = (action: GitRemotePrimaryAction, labelKey: string, disabledReason?: string) => ({
    action,
    labelKey,
    ...(disabledReason ? { disabledReason } : {}),
  });
  const result = (
    action: GitRemotePrimaryAction,
    label: string,
    summaryKey: string,
    disabled?: string,
  ): Presentation => ({ primary: primary(action, label, disabled), summaryKey, failure });

  // 正在合并、未连接远端和未发布分支先于失败重试；不能为“重试”跳过必要的恢复步骤。
  if (remote?.operation === "merge" || (remote?.conflicts.length ?? 0) > 0)
    return {
      primary: primary("inspect", "commit.refreshGitStatus"),
      summaryKey: "commit.mergePending",
      hintKey: "commit.mergeExternalHelp",
      failure: null,
    };
  if (!input.branch) return result(null, "commit.push", "commit.detachedHead");
  if (remote?.remotes.length === 0)
    return result("configure", "commit.configureRemote", "commit.noRemote");
  if (remote?.upstream === null || input.pushStatus === "not_configured")
    return result("publish", "commit.publishBranch", "commit.unpublished");
  const summary =
    (remote?.ahead ?? 0) > 0
      ? "commit.ahead"
      : (remote?.behind ?? 0) > 0
        ? "commit.behind"
        : remote?.ahead === 0 && remote.behind === 0
          ? "commit.synced"
          : input.inspecting
            ? "commit.awaitingCheck"
            : input.pushStatus === "pushed"
              ? "commit.pushedToRemote"
              : input.commitSha
                ? "commit.savedLocally"
                : "commit.remoteReady";
  if ((remote?.ahead ?? 0) > 0 && (remote?.behind ?? 0) > 0)
    return {
      ...result("inspect", "commit.refreshGitStatus", summary),
      hintKey: "commit.divergedExternalHelp",
    };
  if (failure?.remote && input.hasActions) {
    if (kind === "state_changed") return result("inspect", "commit.refreshGitStatus", summary);
    if (kind === "invalid_remote" || kind === "permission")
      return result("configure", "commit.configureRemote", summary);
    if (kind === "protected_branch") return result("branch", "commit.createFeatureBranch", summary);
    if (["authentication", "network", "unknown_result"].includes(kind))
      return result("fetch", "commit.checkConnection", summary);
    if (kind === "remote_updates" && !(remote?.behind ?? 0))
      return result("fetch", "commit.fetchRemote", summary);
  }
  if ((remote?.behind ?? 0) > 0)
    return result(
      "integrate",
      "commit.pullRemote",
      summary,
      input.hasWorkingChanges ? "commit.pullNeedsCommit" : undefined,
    );
  if (!remote && input.hasActions)
    return result(
      "inspect",
      "commit.inspectRemote",
      input.inspecting ? "commit.awaitingCheck" : "commit.remoteUnknown",
    );
  if (remote?.ahead === 0 && remote.behind === 0)
    return result(input.hasActions ? "fetch" : null, "commit.fetchRemote", summary);
  if (input.pushStatus === "pushed" && !remote) return result(null, "commit.pushed", summary);
  return result("push", failure?.remote ? "commit.pushAgain" : "commit.push", summary);
}

export const gitRemotePendingLabels: Readonly<
  Record<NonNullable<PushProjectCommitsRequest["action"]>, string>
> = {
  push: "commit.pushing",
  fetch: "commit.fetchingRemote",
  inspect: "commit.inspectingRemote",
  configure: "commit.configuringRemote",
  publish: "commit.publishingBranch",
  integrate: "commit.integratingRemote",
  branch: "commit.creatingFeatureBranch",
};
