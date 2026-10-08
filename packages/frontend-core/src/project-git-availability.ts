import type { ProjectGitStatus } from "@codexly/protocol";

type GitAvailability = Pick<ProjectGitStatus, "repositoryMode">;

/** 两端仅将当前项目根仓库视为 Git 项目，子仓库状态不能启用相关查询或界面。 */
export function isRootGitProject<T extends GitAvailability>(status: T | undefined): status is T {
  return status?.repositoryMode === "root";
}
