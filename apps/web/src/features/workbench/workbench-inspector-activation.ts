import type { ProjectGitStatus } from "@codexly/protocol";

import type { WorkbenchInspectorTab } from "./components/workbench-inspector-tabs.js";

type InspectorGitAvailability = Readonly<{
  repositoryMode: ProjectGitStatus["repositoryMode"];
  staged: readonly unknown[];
  unstaged: readonly unknown[];
}>;

type InspectorActivationInput = Readonly<{
  contextOnly?: boolean;
  gitStatus: InspectorGitAvailability | undefined;
  inspectorOpen: boolean;
  requestedTab: WorkbenchInspectorTab;
  taskId: string | undefined;
}>;

export function shouldEnableProjectGitDetails({
  activePanel,
  gitStatus,
  temporary,
}: Readonly<{
  activePanel: boolean;
  gitStatus: InspectorGitAvailability | undefined;
  temporary: boolean;
}>): boolean {
  return (
    !temporary &&
    activePanel &&
    gitStatus !== undefined &&
    gitStatus.repositoryMode !== "none" &&
    gitStatus.staged.length + gitStatus.unstaged.length > 0
  );
}

export function getAvailableWorkbenchInspectorTabs(
  taskId: string | undefined,
  gitStatus: InspectorGitAvailability | undefined,
): WorkbenchInspectorTab[] {
  const isGitProject = gitStatus !== undefined && gitStatus.repositoryMode !== "none";
  const hasGitChanges = isGitProject && gitStatus.staged.length + gitStatus.unstaged.length > 0;
  const tabs: WorkbenchInspectorTab[] = [];

  // 标签顺序是稳定的，能力消失时由激活策略统一回落到项目标签。
  if (taskId !== undefined) tabs.push("context");
  tabs.push("project");
  if (hasGitChanges) tabs.push("changes");
  if (isGitProject) tabs.push("history");
  return tabs;
}

export function deriveWorkbenchInspectorActivation({
  contextOnly = false,
  gitStatus,
  inspectorOpen,
  requestedTab,
  taskId,
}: InspectorActivationInput) {
  const availableTabs = getAvailableWorkbenchInspectorTabs(taskId, gitStatus);
  const activeTab = contextOnly
    ? "context"
    : availableTabs.includes(requestedTab)
      ? requestedTab
      : "project";

  // 只有当前可见标签获得激活权，所有标签专属 Query 和 Effect 都复用该结果。
  return {
    activeTab,
    changes: inspectorOpen && activeTab === "changes",
    context: inspectorOpen && activeTab === "context",
    history: inspectorOpen && activeTab === "history",
    project: inspectorOpen && activeTab === "project",
  } as const;
}
