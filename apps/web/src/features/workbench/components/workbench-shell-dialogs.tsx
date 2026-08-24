import { lazy, Suspense } from "react";

import { FileDiffDialog } from "../../diff/file-diff-dialog.js";
import { FileReviewDialog } from "../../diff/file-review-dialog.js";
import { loadGlobalSettingsDialog } from "../../settings/components/global-settings-lazy.js";
import { ProjectSourceDialog } from "./project-source-dialog.js";
import { SubagentOutputDialog } from "./subagent-output-dialog.js";
import { TaskRenameDialog } from "./task-rename-dialog.js";
import type { useWorkbenchShellController } from "./workbench-shell-controller.js";

const LazyGlobalSettingsDialog = lazy(() =>
  loadGlobalSettingsDialog().then((module) => ({ default: module.GlobalSettingsDialog })),
);

export function WorkbenchShellDialogs({
  context,
  projectId,
  projectToolsEnabled,
  taskId,
}: Readonly<{
  context: ReturnType<typeof useWorkbenchShellController>;
  projectId: string;
  projectToolsEnabled: boolean;
  taskId?: string;
}>) {
  const {
    access,
    appInfoQuery,
    appUpdateMutation,
    client,
    closeTaskRenameDialog,
    globalSettingsMutation,
    globalSettingsSection,
    globalSettingsQuery,
    fastModeAvailable,
    models,
    modelsQuery,
    projectOpenCapabilitiesQuery,
    projectRuntime,
    renameActiveTask,
    renameMutation,
    selectedFileChange,
    selectedFileReview,
    selectedSourceFile,
    selectedRootPath,
    selectedSubagent,
    setFileDiffSelection,
    setFileReviewSelection,
    setGlobalSettingsSection,
    setSourceFileSelection,
    setSubagentDialogSelection,
    taskRenameOpen,
    title,
  } = context;
  return (
    <>
      {selectedFileChange === null ? null : (
        <FileDiffDialog
          change={selectedFileChange}
          onClose={() => {
            setFileDiffSelection(null);
          }}
        />
      )}
      {selectedFileReview === null ? null : (
        <FileReviewDialog
          changes={selectedFileReview}
          onClose={() => {
            setFileReviewSelection(null);
          }}
        />
      )}
      {selectedSourceFile === null ? null : (
        <ProjectSourceDialog
          client={client}
          onClose={() => {
            setSourceFileSelection(null);
          }}
          projectId={projectId}
          previewKind={selectedSourceFile.kind}
          reference={selectedSourceFile.reference}
          {...(selectedRootPath === undefined ? {} : { rootPath: selectedRootPath })}
        />
      )}
      <SubagentOutputDialog
        onClose={() => {
          setSubagentDialogSelection(null);
        }}
        projectId={projectId}
        projectRuntime={projectRuntime}
        selection={selectedSubagent}
      />
      {taskRenameOpen && taskId !== undefined ? (
        <TaskRenameDialog
          initialTitle={title}
          isPending={renameMutation.isPending}
          key={`${projectId}:${taskId}`}
          onClose={closeTaskRenameDialog}
          onRename={(nextTitle) => void renameActiveTask(nextTitle)}
        />
      ) : null}
      {globalSettingsSection === null ? null : (
        <Suspense fallback={null}>
          <LazyGlobalSettingsDialog
            {...(access.status === undefined ? {} : { accessMode: access.status.mode })}
            {...(appInfoQuery.data === undefined ? {} : { appInfo: appInfoQuery.data })}
            appInfoError={appInfoQuery.error}
            apps={projectToolsEnabled ? (projectOpenCapabilitiesQuery.data?.apps ?? []) : []}
            error={
              globalSettingsQuery.error ??
              modelsQuery.error ??
              (projectToolsEnabled ? projectOpenCapabilitiesQuery.error : null)
            }
            isPending={
              globalSettingsQuery.isPending ||
              modelsQuery.isPending ||
              (projectToolsEnabled && projectOpenCapabilitiesQuery.isPending)
            }
            fastModeAvailable={fastModeAvailable}
            initialSection={globalSettingsSection}
            isAppInfoPending={appInfoQuery.isPending}
            isAppUpdatePending={appUpdateMutation.isPending}
            models={models}
            onClose={() => {
              const triggerId =
                globalSettingsSection === "about"
                  ? "#global-settings-about-trigger"
                  : "#global-settings-trigger";
              setGlobalSettingsSection(null);
              requestAnimationFrame(() => {
                document.querySelector<HTMLButtonElement>(triggerId)?.focus();
              });
            }}
            onLogoutAccess={access.logout}
            onRetry={() =>
              Promise.all([
                globalSettingsQuery.refetch(),
                modelsQuery.refetch(),
                ...(projectToolsEnabled ? [projectOpenCapabilitiesQuery.refetch()] : []),
              ])
            }
            onRetryAppInfo={() => appInfoQuery.refetch()}
            onSave={(settings) =>
              globalSettingsMutation.mutateAsync(settings).then(() => undefined)
            }
            onUpdate={(version) => appUpdateMutation.mutateAsync(version).then(() => undefined)}
            {...(globalSettingsQuery.data === undefined
              ? {}
              : { settings: globalSettingsQuery.data.settings })}
          />
        </Suspense>
      )}
    </>
  );
}
