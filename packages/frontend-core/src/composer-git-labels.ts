/** 工作树选择面板的共用文案，保持 Web 与桌面端术语一致。 */
export const composerGitChinese = {
  gitPickerTitle: "选择工作树或分支",
  gitCurrent: "当前使用",
  gitMainWorktree: "主目录",
  gitWorktreeHint: "切换独立目录，各自保留文件改动。",
  gitBranchHint: "在当前工作目录中切换分支。",
  gitSearchWorktrees: "搜索工作树或路径…",
  gitSearchBranches: "搜索分支…",
  gitNoResults: "没有匹配项，可在下方创建。",
  gitOccupied: "其他工作树使用中",
  gitRetry: "重新加载",
  gitLoadError: "无法读取工作树",
  gitBaseBranch: "起点分支",
  gitLocation: "存放位置",
  gitBranches: "分支",
} as const;

export const composerGitEnglish = {
  gitPickerTitle: "Choose a worktree or branch",
  gitCurrent: "Current",
  gitMainWorktree: "Main folder",
  gitWorktreeHint: "Switch folders, keeping changes in each worktree.",
  gitBranchHint: "Switch branches in the current working directory.",
  gitSearchWorktrees: "Search worktrees or paths…",
  gitSearchBranches: "Search branches…",
  gitNoResults: "No matches. Create one below.",
  gitOccupied: "In another worktree",
  gitRetry: "Reload",
  gitLoadError: "Unable to load worktrees",
  gitBaseBranch: "Starting branch",
  gitLocation: "Location",
  gitBranches: "Branches",
} as const;
