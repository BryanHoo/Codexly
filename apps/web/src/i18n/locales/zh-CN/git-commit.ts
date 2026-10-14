import { gitWorkspaceChinese } from "@codexly/frontend-core/git-workspace-copy";
import { gitActionsChinese } from "@codexly/frontend-core/project-git-actions";
import { gitPushChinese } from "@codexly/frontend-core/project-git-push";

export const gitCommit = {
  ...gitWorkspaceChinese,
  ...gitPushChinese,
  ...gitActionsChinese,
  allFiles: "全选",
  commit: "提交",
  commitActions: "选择提交方式",
  commitAndPush: "提交并推送",
  commitAndPushComplete: "提交并推送已完成",
  commitAndPushSucceeded: "提交并推送成功",
  commitComplete: "提交已完成",
  commitCompletePushFailed: "提交已完成，但推送失败",
  commitCompleteUpstreamMissing: "提交已完成，当前分支未配置上游",
  commitMessage: "提交信息",
  commitSucceeded: "提交成功",
  changes: "变更",
  generateMessage: "AI 生成",
  messagePlaceholder: "输入提交信息",
  repository: "Git 项目",
  repositoryLoading: "正在加载 Git 项目",
  repositoryUnavailable: "未找到可提交的 Git 项目",
  selectAllFiles: "全选文件",
  selectFiles: "选择文件",
  selectRepository: "选择 Git 项目",
  selectionLabel: "选择文件，已选择 {{selected}}/{{total}} 个文件",
  staged: "已暂存",
  totalFiles_one: "共 {{count}} 个",
  totalFiles_other: "共 {{count}} 个",
  unstaged: "未暂存",
} as const;
