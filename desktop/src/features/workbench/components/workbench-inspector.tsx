import type {
  AgentBackgroundTerminal,
  AgentMcpServer,
  AgentSkill,
  AgentTaskSnapshot,
  ProjectFileSearchEntry,
  ProjectGitStatus,
  ProjectOpenApp,
  ProjectOpenAppId,
} from "@/protocol/index.js";
import { RefreshCw } from "lucide-react";
import { lazy, Suspense, useMemo } from "react";

import { i18n, useTranslation } from "../../../i18n/i18n.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import type { TaskStore } from "../../conversation/runtime/task-store.js";
import { FileDiffPanel } from "../../diff/file-diff-panel.js";
import type { MessageFileReference } from "../../../shared/components/agent/message.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import type { SubagentContextEntry, SubagentSelection } from "./subagent.js";
import {
  BackgroundTerminalSection,
  McpServerSection,
  SubagentSection,
} from "./workbench-inspector-sections.js";
import { PlanSection } from "./workbench-inspector-plan.js";
import { deriveInspectorGitChangeState } from "./workbench-inspector-git-status.js";
import { InspectorGitChangesSection } from "./workbench-inspector-git-changes.js";
import { GoalSection } from "./workbench-inspector-goal.js";
import {
  WorkbenchInspectorHeader,
  type WorkbenchInspectorTab,
} from "./workbench-inspector-tabs.js";
import { nativeClient, type NativeWorkbenchClient } from "../../projects/project-queries.js";
import { WorkbenchProjectFileTree } from "./workbench-project-file-tree.js";
import { ProjectSourcePanel } from "./project-source-panel.js";
import {
  deriveWorkbenchInspectorActivation,
  getAvailableWorkbenchInspectorTabs,
} from "../workbench-inspector-activation.js";

const emptyExpandedFileTreePaths = new Set<string>();
const emptyFileChangesByPath = new Map<string, AgentFileChange>();

// 次级 Git 面板只在用户首次选择对应标签时下载和执行。
const LazyGitHistoryPanel = lazy(async () => {
  const module = await import("./git-history-panel.js");
  return { default: module.GitHistoryPanel };
});
const LazyWorkbenchInspectorChanges = lazy(async () => {
  const module = await import("./workbench-inspector-changes.js");
  return { default: module.WorkbenchInspectorChanges };
});
const LazyRuntimeWarningsSection = lazy(async () => {
  const module = await import("./workbench-inspector-runtime-warnings.js");
  return { default: module.StoreRuntimeWarningsSection };
});
const LazyInspectorSources = lazy(async () => {
  const module = await import("./workbench-inspector-sources.js");
  return { default: module.InspectorSources };
});
type WorkbenchInspectorProps = Readonly<{
  backgroundTerminals?: readonly AgentBackgroundTerminal[];
  contextOnly?: boolean;
  expandedFileTreePaths?: Set<string>;
  fileSelection?: WorkbenchInspectorFileSelection | null;
  gitStatus?: ProjectGitStatus;
  gitStatusDetails?: ProjectGitStatus | undefined;
  gitStatusDetailsError?: Error | null;
  gitStatusDetailsPending?: boolean;
  gitStatusError?: Error | null;
  gitStatusPending?: boolean;
  gitStatusRefreshing?: boolean;
  gitClient?: NativeWorkbenchClient;
  mcpServers?: readonly AgentMcpServer[];
  mcpServersRetryAvailable?: boolean;
  mcpServersRefreshing?: boolean;
  mcpServersRetrying?: boolean;
  onFileTreeExpandedChange?: (expandedPaths: Set<string>) => void;
  onClearGoal?: () => Promise<void>;
  onGoalStatusChange?: (status: "active" | "paused") => Promise<void>;
  onOpenFileDiff?: (change: AgentFileChange) => void;
  onReviewFileChanges?: (changes: readonly AgentFileChange[]) => void;
  onOpenTaskAttachment?: (attachmentId: string) => void;
  onOpenProjectPath?: (appId: ProjectOpenAppId, path?: string) => void;
  onOpenProjectFile?: (path: string) => void;
  onReferenceProjectPath?: (entry: ProjectFileSearchEntry) => void;
  onOpenSubagent?: (selection: SubagentSelection) => void;
  onReloadMcpServers?: () => void;
  onRefreshGitStatus?: () => void;
  onRefreshProject?: () => unknown;
  onCommitChanges?: () => void;
  onClose?: () => void;
  onCloseFile?: () => void;
  onTerminateBackgroundTerminal?: (terminalId: string) => Promise<void>;
  onTabChange?: (tab: WorkbenchInspectorTab) => void;
  projectName: string;
  projectId?: string;
  projectOpenApps?: readonly ProjectOpenApp[];
  projectOpenPending?: boolean;
  projectPath: string;
  projectRootId: string;
  sourceRootPath?: string;
  projectRefreshing?: boolean;
  skills?: readonly AgentSkill[];
  subagents?: readonly SubagentContextEntry[];
  tab?: WorkbenchInspectorTab;
  task?: Pick<AgentTaskSnapshot, "turns"> & Partial<Pick<AgentTaskSnapshot, "goal" | "plan">>;
  taskId?: string;
  taskStore?: TaskStore;
  terminatingTerminalId?: string | null;
}>;

export type WorkbenchInspectorFileSelection =
  | Readonly<{
      change?: AgentFileChange;
      kind: "image" | "source";
      reference: MessageFileReference;
    }>
  | Readonly<{
      change: AgentFileChange;
      kind: "diff";
    }>;

export type { WorkbenchInspectorTab } from "./workbench-inspector-tabs.js";

export function WorkbenchInspector({
  backgroundTerminals = [],
  contextOnly = false,
  expandedFileTreePaths = emptyExpandedFileTreePaths,
  fileSelection = null,
  gitStatus,
  gitStatusDetails,
  gitStatusDetailsError = null,
  gitStatusDetailsPending = false,
  gitStatusError = null,
  gitStatusPending = false,
  gitStatusRefreshing = false,
  gitClient,
  mcpServers = [],
  mcpServersRetryAvailable = true,
  mcpServersRefreshing = false,
  mcpServersRetrying = false,
  onFileTreeExpandedChange = () => undefined,
  onClearGoal = () => Promise.resolve(),
  onGoalStatusChange = () => Promise.resolve(),
  onOpenFileDiff = () => undefined,
  onReviewFileChanges = () => undefined,
  onOpenTaskAttachment = () => undefined,
  onOpenProjectPath = () => undefined,
  onOpenProjectFile = () => undefined,
  onReferenceProjectPath = () => undefined,
  onOpenSubagent = () => undefined,
  onReloadMcpServers = () => undefined,
  onRefreshGitStatus = () => undefined,
  onRefreshProject = () => undefined,
  onCommitChanges = () => undefined,
  onClose,
  onCloseFile,
  onTerminateBackgroundTerminal = () => Promise.resolve(),
  onTabChange = () => undefined,
  projectId,
  projectName,
  projectOpenApps = [],
  projectOpenPending = false,
  projectPath,
  projectRootId,
  sourceRootPath,
  projectRefreshing = false,
  skills = [],
  subagents = [],
  tab = "project",
  task,
  taskId,
  taskStore,
  terminatingTerminalId = null,
}: WorkbenchInspectorProps) {
  useTranslation("conversation");
  const availableTabs = getAvailableWorkbenchInspectorTabs(taskId, gitStatus, {
    contextOnly,
    fileOpen: fileSelection !== null,
  });
  const { activeTab } = deriveWorkbenchInspectorActivation({
    contextOnly,
    fileOpen: fileSelection !== null,
    gitStatus,
    inspectorOpen: true,
    requestedTab: tab,
    taskId,
  });
  const isGitProject = gitStatus !== undefined && gitStatus.repositoryMode !== "none";
  const { changeStats, displayChanges, fileChangesByPath } = useMemo(
    () =>
      isGitProject && activeTab === "project"
        ? deriveInspectorGitChangeState(gitStatus, gitStatusDetails)
        : {
            changeStats: undefined,
            displayChanges: [],
            fileChangesByPath: emptyFileChangesByPath,
          },
    [activeTab, gitStatus, gitStatusDetails, isGitProject],
  );
  const projectRootName = projectPath.split(/[\\/]/u).filter(Boolean).at(-1) ?? projectName;
  const contextContent = (
    <div
      className="h-full space-y-5 overflow-y-auto p-2.5"
      key={`${projectId ?? projectName}:${taskId ?? "draft"}:context`}
    >
      {task?.goal === null || task?.goal === undefined ? null : (
        <GoalSection goal={task.goal} onClear={onClearGoal} onStatusChange={onGoalStatusChange} />
      )}
      {taskStore === undefined ? null : (
        <Suspense fallback={null}><LazyRuntimeWarningsSection store={taskStore} /></Suspense>
      )}
      {backgroundTerminals.length > 0 ? (
        <BackgroundTerminalSection
          onTerminate={onTerminateBackgroundTerminal}
          terminals={backgroundTerminals}
          terminatingTerminalId={terminatingTerminalId}
        />
      ) : null}
      {subagents.length > 0 ? (
        <SubagentSection onOpenSubagent={onOpenSubagent} subagents={subagents} />
      ) : null}
      <McpServerSection
        canRetry={mcpServersRetryAvailable}
        isRefreshing={mcpServersRefreshing}
        isRetrying={mcpServersRetrying}
        onRetry={onReloadMcpServers}
        servers={mcpServers}
      />
      <Suspense fallback={null}>
        <LazyInspectorSources
          onOpenAttachment={onOpenTaskAttachment}
          {...(projectId === undefined ? {} : { projectId })}
          skills={skills}
          {...(taskId === undefined ? {} : { taskId })}
          turns={task?.turns ?? []}
        />
      </Suspense>
      {task?.plan === null || task?.plan === undefined ? null : <PlanSection plan={task.plan} />}
      <p className="hidden min-h-full place-items-center px-4 text-center text-body-small text-muted-foreground only:grid">
        {i18n.t("inspector.emptyContext", { ns: "conversation" })}
      </p>
    </div>
  );
  return (
    <aside
      aria-label={i18n.t("inspector.title", { ns: "conversation" })}
      className="workbench-inspector relative z-30 flex min-h-0 flex-col bg-panel shadow-divider-reverse"
    >
      <WorkbenchInspectorHeader
        activeTab={activeTab}
        availableTabs={availableTabs}
        onClose={onClose}
        {...(onCloseFile === undefined ? {} : { onCloseFile })}
        onTabChange={onTabChange}
      />

      <div className="min-h-0 flex-1 overflow-hidden" role="tabpanel">
        {activeTab === "file" && fileSelection !== null ? (
          fileSelection.kind === "diff" ? (
            <FileDiffPanel change={fileSelection.change} />
          ) : (
            <ProjectSourcePanel
              client={gitClient ?? nativeClient}
              previewKind={fileSelection.kind}
              projectId={projectId ?? projectName}
              reference={fileSelection.reference}
              {...(sourceRootPath === undefined ? {} : { rootPath: sourceRootPath })}
              {...(taskId === undefined ? {} : { taskId })}
            />
          )
        ) : activeTab === "project" ? (
          <div className="flex h-full min-h-0 flex-col">
            {isGitProject && displayChanges.length > 0 ? (
              <div className="shrink-0 px-2.5 py-0.5">
                <InspectorGitChangesSection
                  changeCount={displayChanges.length}
                  changeStats={changeStats}
                  onCommitChanges={onCommitChanges}
                  onReviewChanges={() => onReviewFileChanges(displayChanges)}
                />
              </div>
            ) : null}
            <div className="flex min-h-0 flex-1 flex-col">
              {gitStatusError !== null ? (
                <div className="mx-2.5 mb-2 flex items-center gap-2 rounded-control bg-control px-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-label text-diff-removed">
                      {i18n.t("inspector.gitChangesRetrying", { ns: "conversation" })}
                    </p>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={i18n.t("inspector.refreshGit", { ns: "conversation" })}
                        disabled={gitStatusRefreshing}
                        onClick={onRefreshGitStatus}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <RefreshCw
                          aria-hidden="true"
                          className={`size-3.5 ${gitStatusRefreshing ? "animate-spin" : ""}`}
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {i18n.t("inspector.refreshGit", { ns: "conversation" })}
                    </TooltipContent>
                  </Tooltip>
                </div>
              ) : gitStatusPending && gitStatus === undefined ? (
                <p className="mb-2 px-4 text-caption text-muted-foreground">
                  {i18n.t("inspector.gitLoading", { ns: "conversation" })}
                </p>
              ) : null}
              <div className="min-h-0 flex-1 px-2.5 pb-2.5">
                <WorkbenchProjectFileTree
                  client={gitClient ?? nativeClient}
                  expandedPaths={expandedFileTreePaths}
                  fileChangesByPath={fileChangesByPath}
                  key={`${projectId ?? projectName}:${projectPath}`}
                  onExpandedPathsChange={onFileTreeExpandedChange}
                  onOpenProjectFile={onOpenProjectFile}
                  onOpenProjectPath={onOpenProjectPath}
                  onReferenceProjectPath={onReferenceProjectPath}
                  onRefreshProject={onRefreshProject}
                  projectId={projectId ?? projectName}
                  projectName={projectRootName}
                  projectOpenApps={projectOpenApps}
                  projectOpenPending={projectOpenPending}
                  projectPath={projectPath}
                  projectRootId={projectRootId}
                  projectRefreshing={projectRefreshing}
                />
              </div>
            </div>
          </div>
        ) : activeTab === "changes" ? (
          <Suspense fallback={null}>
            <LazyWorkbenchInspectorChanges
              client={gitClient}
              detailsError={gitStatusDetailsError}
              detailsPending={gitStatusDetailsPending}
              detailsStatus={gitStatusDetails}
              gitStatus={gitStatus}
              gitStatusError={gitStatusError}
              onOpenFileDiff={onOpenFileDiff}
              projectId={projectId}
              rootPath={projectPath}
            />
          </Suspense>
        ) : activeTab === "history" && projectId !== undefined ? (
          <Suspense fallback={null}>
            <LazyGitHistoryPanel
              {...(gitClient === undefined ? {} : { client: gitClient })}
              projectId={projectId}
              rootPath={projectPath}
            />
          </Suspense>
        ) : (
          contextContent
        )}
      </div>
    </aside>
  );
}
