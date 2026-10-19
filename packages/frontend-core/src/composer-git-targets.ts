/** 当前分支不再列为切换目标；工作树由独立菜单按路径选择。 */
export function resolveComposerGitSwitchTargets(
  branches: readonly string[],
  currentBranch: string | null,
) {
  return { branches: branches.filter((branch) => branch !== currentBranch) };
}
