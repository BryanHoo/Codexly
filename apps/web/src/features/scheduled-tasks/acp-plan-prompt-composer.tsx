import { useCallback, useMemo } from "react";
import { TEMPORARY_TASK_SCOPE_ID } from "@codexly/protocol";
import type { AcpPlanPromptProps } from "@codexly/ui/core/acp-plan-contract";
import {
  WorkbenchComposer,
  type WorkbenchComposerHandle,
} from "../workbench/components/workbench-composer.js";
import type { useWorkbenchShellController } from "../workbench/components/workbench-shell-controller.js";
import { createPromptSkillContent } from "../workbench/components/prompt-skill-content.js";

const noop = () => undefined;

/** 复用中栏输入框，平台环境由工作台提供，提交由计划事务接管。 */
export function AcpPlanPromptComposer({
  context,
  currentProjectId,
  ...props
}: AcpPlanPromptProps & {
  context: ReturnType<typeof useWorkbenchShellController>;
  currentProjectId: string;
}) {
  const initialDraft = useMemo(
    () => ({
      content: createPromptSkillContent(props.prompt.text),
      attachments: props.attachments.map((attachment) => ({
        ...attachment,
        attachment,
        previewUrl: "",
        source: "host" as const,
      })),
    }),
    [props.prompt, props.attachments],
  );
  const project = context.projects.find((item) => item.id === props.projectId);
  const current = currentProjectId === props.projectId;
  const roots = (current ? context.projectRoots : project?.roots) ?? [];
  const root = roots.find((item) => item.id === (current ? context.selectedRootId : roots[0]?.id));
  const ref = useCallback(
    (handle: WorkbenchComposerHandle | null) => {
      props.composerRef.current = handle;
    },
    [props.composerRef],
  );
  return (
    <WorkbenchComposer
      capabilities={context.capabilities}
      client={context.client}
      composerRef={ref}
      composerDraftId={`scheduled:${props.id}`}
      captureSubmitVisible={false}
      footerVisible={false}
      initialDraft={initialDraft}
      models={[]}
      modelsError={null}
      modelsPending={false}
      fastModeAvailable={false}
      fastModeDefault={false}
      followUpBehavior="queue"
      settings={undefined}
      skills={[]}
      projectId={props.projectId}
      {...(project ? { projectName: project.name } : {})}
      projectPath={root?.path ?? ""}
      projectPathOpenDisabled={!current || context.projectFolderOpenDisabled}
      projectRoots={roots}
      projectToolsEnabled={props.projectId !== TEMPORARY_TASK_SCOPE_ID}
      selectedProjectRootId={root?.id ?? ""}
      onOpenProjectPath={current ? context.openProjectFolder : noop}
      onProjectRootChange={noop}
      onFastModeChange={noop}
      onSettingsChange={noop}
      onTaskStarted={noop}
      onRequestNotificationPermission={noop}
      scheduledCapture={{ initialConfig: props.initialConfig, onCapture: props.onCapture }}
      onInputStateChange={props.onInputStateChange}
      onSubmissionStateChange={props.onSubmissionStateChange}
    />
  );
}
