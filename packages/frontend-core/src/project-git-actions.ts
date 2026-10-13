import type { CommitProjectChangesRequest, CommitProjectChangesResponse } from "@codexly/protocol";

export type GitCommitAction = CommitProjectChangesRequest["action"];
export type GitPushStatus = CommitProjectChangesResponse["pushStatus"];

export const gitActionsChinese = {
  moreGitActions: "更多 Git 操作",
  pushExistingCommits: "推送已有提交",
  commitAndPushDescription: "保存所选变更，并推送本地提交",
  pushExistingDescription: "只推送本地提交，保留未提交变更",
  committing: "提交中…",
  committingAndPushing: "提交并推送中…",
  generatingMessage: "生成中…",
  pushAgain: "重试推送",
  pushed: "已推送",
  emptyWorkingTree: "暂无未提交变更",
  emptyWorkingTreeDescription: "已保存的本地提交仍可推送到远端。",
  savedLocally: "已保存到本地，尚未推送",
  pushedToRemote: "已推送到远端",
  savedButPushFailed: "提交已保存，推送未完成",
} as const;

export const gitActionsEnglish = {
  moreGitActions: "More Git actions",
  pushExistingCommits: "Push existing commits",
  commitAndPushDescription: "Save selected changes and push local commits",
  pushExistingDescription: "Push local commits without committing working changes",
  committing: "Committing…",
  committingAndPushing: "Committing and pushing…",
  generatingMessage: "Generating…",
  pushAgain: "Retry push",
  pushed: "Pushed",
  emptyWorkingTree: "No uncommitted changes",
  emptyWorkingTreeDescription: "Saved local commits can still be pushed to the remote.",
  savedLocally: "Saved locally, not pushed yet",
  pushedToRemote: "Pushed to the remote",
  savedButPushFailed: "Commit saved, push incomplete",
} as const;

/** 两端共享操作文案映射，保持按钮、菜单和结果提示的名称一致。 */
export function createGitActionLabels(translate: (key: string) => string) {
  return {
    commit: translate("commit.commit"),
    commitAndPush: translate("commit.commitAndPush"),
    push: translate("commit.push"),
    pushing: translate("commit.pushing"),
    pushFailed: translate("commit.pushFailed"),
    pushUpstreamMissing: translate("commit.pushUpstreamMissing"),
    moreGitActions: translate("commit.moreGitActions"),
    pushExistingCommits: translate("commit.pushExistingCommits"),
    commitAndPushDescription: translate("commit.commitAndPushDescription"),
    pushExistingDescription: translate("commit.pushExistingDescription"),
    committing: translate("commit.committing"),
    committingAndPushing: translate("commit.committingAndPushing"),
    generatingMessage: translate("commit.generatingMessage"),
    pushAgain: translate("commit.pushAgain"),
    pushed: translate("commit.pushed"),
    emptyWorkingTree: translate("commit.emptyWorkingTree"),
    emptyWorkingTreeDescription: translate("commit.emptyWorkingTreeDescription"),
    savedLocally: translate("commit.savedLocally"),
    pushedToRemote: translate("commit.pushedToRemote"),
    savedButPushFailed: translate("commit.savedButPushFailed"),
  };
}

export type GitActionLabels = Readonly<ReturnType<typeof createGitActionLabels>>;
