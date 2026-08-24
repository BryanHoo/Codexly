import type { ProjectGitStatus } from "@codexly/protocol";

import type { WorkbenchInspectorTab } from "./components/workbench-inspector-tabs.js";

type InspectorGitAvailability = Readonly<{
  repositoryMode: ProjectGitStatus["repositoryMode"];
  staged: readonly unknown[];
  unstaged: readonly unknown[];
}>;

type InspectorActivationInput = Readonly<{
  contextOnly?: boolean;
  fileOpen?: boolean;
  gitStatus: InspectorGitAvailability | undefined;
  inspectorOpen: boolean;
  requestedTab: WorkbenchInspectorTab;
  taskId: string | undefined;
}>;

type InspectorTabAvailability = Readonly<{
  contextOnly?: boolean;
  fileOpen?: boolean;
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
  { contextOnly = false, fileOpen = false }: InspectorTabAvailability = {},
): WorkbenchInspectorTab[] {
  const isGitProject = gitStatus !== undefined && gitStatus.repositoryMode !== "none";
  const hasGitChanges = isGitProject && gitStatus.staged.length + gitStatus.unstaged.length > 0;
  const tabs: WorkbenchInspectorTab[] = [];

  if (contextOnly) {
    tabs.push("context");
    if (fileOpen) tabs.push("file");
    return tabs;
  }
  // 标签顺序是稳定的，能力消失时由激活策略统一回落到项目标签。
  if (taskId !== undefined) tabs.push("context");
  tabs.push("project");
  if (hasGitChanges) tabs.push("changes");
  if (isGitProject) tabs.push("history");
  // 文件标签只代表当前选择，不保留空面板或历史文件列表。
  if (fileOpen) tabs.push("file");
  return tabs;
}

export function deriveWorkbenchInspectorActivation({
  contextOnly = false,
  fileOpen = false,
  gitStatus,
  inspectorOpen,
  requestedTab,
  taskId,
}: InspectorActivationInput) {
  const availableTabs = getAvailableWorkbenchInspectorTabs(taskId, gitStatus, {
    contextOnly,
    fileOpen,
  });
  const activeTab = contextOnly
    ? requestedTab === "file" && fileOpen
      ? "file"
      : "context"
    : availableTabs.includes(requestedTab)
      ? requestedTab
      : "project";

  // 只有当前可见标签获得激活权，所有标签专属 Query 和 Effect 都复用该结果。
  return {
    activeTab,
    changes: inspectorOpen && activeTab === "changes",
    context: inspectorOpen && activeTab === "context",
    file: inspectorOpen && activeTab === "file",
    history: inspectorOpen && activeTab === "history",
    project: inspectorOpen && activeTab === "project",
  } as const;
}
