import {
  AGENT_FILE_ACCEPT,
  AGENT_IMAGE_ACCEPT,
  MAX_AGENT_FILE_BYTES,
  MAX_AGENT_FILE_TOTAL_BYTES,
  MAX_AGENT_IMAGES,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_IMAGE_TOTAL_BYTES,
} from "@codexly/protocol";
import { ArrowDown, ArrowUp, Folder, LoaderCircle, Pencil, SendHorizontal, X } from "lucide-react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Context, ContextTrigger } from "../../../shared/components/agent/context.js";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTools,
  isPromptInputComposing,
  isPromptInputNewlineShortcut,
} from "../../../shared/components/agent/prompt-input.js";
import { Button } from "../../../shared/components/core/button.js";
import { Tooltip } from "../../../shared/components/core/tooltip.js";
import { TooltipContent } from "../../../shared/components/core/tooltip.js";
import { TooltipTrigger } from "../../../shared/components/core/tooltip.js";
import {
  LARGE_PASTE_CHARACTER_THRESHOLD,
  PASTED_TEXT_ATTACHMENT_NAME,
  resolveComposerPlaceholder,
} from "../composer-state.js";
import { movePromptCommandSelection } from "./prompt-command.js";
import { ComposerBranchSwitcher } from "./composer-branch-switcher.js";
import { ComposerModelSelector } from "./composer-model-selector.js";
import { ComposerApprovalControls } from "./workbench-composer-approval-controls.js";
import { shouldNavigatePromptHistory } from "./prompt-history.js";
import { PromptSkillEditor } from "./prompt-skill-editor.js";
import { ProjectRootSelector } from "./project-root-selector.js";
import { selectionOffset } from "./prompt-skill-editor-dom.js";
import { ComposerCommandMenu } from "./workbench-composer-command-menu.js";
import { ComposerFileMenu } from "./workbench-composer-file-menu.js";
import {
  ComposerAttachments,
  ComposerFastModeButton,
  ComposerModeTag,
} from "./workbench-composer-toolbar.js";
import {
  resolveQueuedPromptSummary,
  type WorkbenchComposerViewProps,
} from "./workbench-composer-view-contracts.js";
export { ComposerFastModeButton, ComposerModeTag } from "./workbench-composer-toolbar.js";
export * from "./workbench-composer-view-contracts.js";

export function ComposerProjectPathButton({
  disabled,
  onOpen,
  projectPath,
}: Readonly<{ disabled: boolean; onOpen: () => void; projectPath: string }>) {
  const { t } = useTranslation("workbench");
  const label = t("composer.openProjectFolder");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className="h-6 w-fit min-w-0 max-w-full shrink gap-1 rounded-control px-1 text-caption text-muted-foreground hover:bg-control-hover hover:text-foreground"
          contentAlign="start"
          disabled={disabled}
          onClick={onOpen}
          type="button"
          variant="ghost"
        >
          <Folder aria-hidden="true" className="size-3 shrink-0" />
          <span className="truncate">{projectPath}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ComposerProjectRootControls({
  onOpen,
  onRootChange,
  projectPath,
  projectPathOpenDisabled,
  roots,
  selectedRootId,
}: Readonly<{
  onOpen: () => void;
  onRootChange: (rootId: string) => void;
  projectPath: string;
  projectPathOpenDisabled: boolean;
  roots: WorkbenchComposerViewProps["projectRoots"];
  selectedRootId: string;
}>) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1" data-composer-project-root-controls="">
      <ProjectRootSelector onChange={onRootChange} roots={roots} value={selectedRootId} />
      <div className="min-w-0 flex-1">
        <ComposerProjectPathButton
          disabled={projectPathOpenDisabled}
          onOpen={onOpen}
          projectPath={projectPath}
        />
      </div>
    </div>
  );
}

export function WorkbenchComposerView(props: WorkbenchComposerViewProps) {
  const { t } = useTranslation(["workbench", "settings"]);
  return (
    <section
      className="shrink-0 bg-content px-1 pb-2 max-[360px]:px-0 sm:px-5"
      aria-label={t("composer.landmark")}
    >
      <div className="relative mx-auto w-full max-w-content" ref={props.commandSurfaceRef}>
        <ComposerCommandMenu props={props} />
        <ComposerFileMenu props={props} />
        {props.queuedPrompts.length === 0 ? null : (
          <div aria-label={t("composer.queuedMessages")} className="mb-2 space-y-1.5" role="list">
            {props.queuedPrompts.map((queuedPrompt, index) => {
              const summary = resolveQueuedPromptSummary(
                queuedPrompt,
                t("composer.attachmentCount", { count: queuedPrompt.files.length }),
              );
              return (
                <div
                  className="flex min-w-0 items-center gap-2 rounded-control border border-separator bg-control px-2 py-1.5"
                  key={queuedPrompt.id}
                  role="listitem"
                >
                  <span className="min-w-0 flex-1 truncate text-label text-foreground">
                    {summary}
                  </span>
                  {queuedPrompt.status === "awaiting-response" ? (
                    <span
                      aria-label={t("composer.waitingToSend")}
                      className="inline-flex shrink-0 items-center gap-1 text-caption text-muted-foreground"
                      role="status"
                    >
                      <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                      {t("composer.waitingToSend")}
                    </span>
                  ) : (
                    <>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            aria-label={t("composer.moveQueuedUp", { summary })}
                            disabled={props.isSubmitting || index === 0}
                            onClick={() => {
                              props.moveQueuedPrompt(queuedPrompt.id, -1);
                            }}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <ArrowUp aria-hidden="true" className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("composer.moveQueuedUpTooltip")}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            aria-label={t("composer.moveQueuedDown", { summary })}
                            disabled={
                              props.isSubmitting || index === props.queuedPrompts.length - 1
                            }
                            onClick={() => {
                              props.moveQueuedPrompt(queuedPrompt.id, 1);
                            }}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <ArrowDown aria-hidden="true" className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("composer.moveQueuedDownTooltip")}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            aria-label={t("composer.editQueued", { summary })}
                            disabled={props.isSubmitting}
                            onClick={() => {
                              props.editQueuedPrompt(queuedPrompt);
                            }}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <Pencil aria-hidden="true" className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("composer.editQueuedTooltip")}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            aria-label={t("composer.steerNow", { summary })}
                            className="hover:text-brand"
                            disabled={
                              props.isSubmitting ||
                              props.taskId === undefined ||
                              (props.activeTurnId === undefined
                                ? !props.canSubmit
                                : !props.canSteer)
                            }
                            onClick={() => {
                              props.steerQueuedPrompt(queuedPrompt);
                            }}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <SendHorizontal aria-hidden="true" className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("composer.steerNowTooltip")}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            aria-label={t("composer.cancelQueued", { summary })}
                            className="hover:text-danger"
                            disabled={props.isSubmitting}
                            onClick={() => {
                              props.removeQueuedPrompt(queuedPrompt.id);
                            }}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <X aria-hidden="true" className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("composer.cancelQueuedTooltip")}</TooltipContent>
                      </Tooltip>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <PromptInput
          attachments={props.attachments}
          aria-busy={props.state === "submitting" || props.state === "reconnecting"}
          className="w-full"
          data-state={props.state}
          disabled={props.attachmentsDisabled}
          fileAccept={AGENT_FILE_ACCEPT}
          globalDrop
          imageAccept={AGENT_IMAGE_ACCEPT}
          largePasteCharacterThreshold={LARGE_PASTE_CHARACTER_THRESHOLD}
          maxFileSize={MAX_AGENT_FILE_BYTES}
          maxFileTotalSize={MAX_AGENT_FILE_TOTAL_BYTES}
          maxImageSize={MAX_AGENT_IMAGE_BYTES}
          maxImages={MAX_AGENT_IMAGES}
          maxImageTotalSize={MAX_AGENT_IMAGE_TOTAL_BYTES}
          multiple
          onAttachmentsChange={props.onAttachmentsChange}
          onError={(error) => {
            props.onViewError(new Error(error.message));
          }}
          onSubmit={props.onSubmit}
          pastedTextFileName={PASTED_TEXT_ATTACHMENT_NAME}
        >
          <ComposerAttachments />
          <PromptInputBody>
            <input name="message" type="hidden" value={props.promptSubmissionText} />
            <PromptSkillEditor
              aria-activedescendant={props.activeCommandItemId}
              aria-controls={
                props.commandMenuOpen || props.fileMenuOpen ? props.commandMenuId : undefined
              }
              aria-expanded={props.commandMenuOpen || props.fileMenuOpen}
              aria-haspopup="listbox"
              aria-label={t("composer.taskInput")}
              content={props.promptContent}
              disabled={props.draftInputDisabled}
              onChange={props.onPromptChange}
              onKeyDown={(event) => {
                if (isPromptInputComposing(event.nativeEvent)) {
                  return;
                }
                if (props.commandMenuOpen || props.fileMenuOpen) {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    props.setActiveCommandIndex((currentIndex) =>
                      movePromptCommandSelection(
                        currentIndex,
                        event.key === "ArrowDown" ? 1 : -1,
                        props.menuItemCount,
                      ),
                    );
                    return;
                  }
                  if (event.key === "Enter" && !isPromptInputNewlineShortcut(event)) {
                    event.preventDefault();
                    props.onSelectActiveCommand();
                  }
                  return;
                }
                if (
                  (event.key === "ArrowDown" || event.key === "ArrowUp") &&
                  !(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
                ) {
                  const selection = document.getSelection();
                  const direction = event.key === "ArrowUp" ? "previous" : "next";
                  const serializedText = event.currentTarget.dataset["serializedValue"] ?? "";
                  if (
                    selection?.isCollapsed === true &&
                    event.currentTarget.contains(selection.anchorNode) &&
                    shouldNavigatePromptHistory(
                      serializedText,
                      selectionOffset(event.currentTarget),
                      direction,
                    ) &&
                    props.onPromptHistoryNavigate(direction)
                  ) {
                    event.preventDefault();
                  }
                }
              }}
              placeholder={resolveComposerPlaceholder(props.taskId)}
              ref={props.skillEditorRef}
              skills={props.skills}
              scope={props.composerScope}
            />
          </PromptInputBody>
          <PromptInputFooter className="max-workbench:gap-0.5 max-workbench:px-1 max-[360px]:!gap-0 max-[360px]:!px-0">
            <PromptInputTools className="max-workbench:shrink-0 max-workbench:gap-0.5 max-[360px]:!gap-0">
              <PromptInputActionAddAttachments
                className="max-workbench:w-8 max-workbench:min-w-8 max-workbench:px-0 max-[360px]:!w-6 max-[360px]:!min-w-6"
                disabled={props.attachmentsDisabled}
                onSelectKind={props.onSelectAttachmentKind}
              />
              <ComposerApprovalControls
                disabled={props.turnControlsDisabled}
                onSettingsChange={props.onSettingsChange}
                sandboxModeSelectable={props.sandboxModeSelectable}
                settings={props.activeSettings}
              />
              {props.composerMode === undefined ? null : (
                <ComposerModeTag
                  disabled={props.turnControlsDisabled}
                  mode={props.composerMode}
                  onRemove={props.onComposerModeRemove}
                />
              )}
              {props.fastModeAvailable ? (
                <ComposerFastModeButton
                  disabled={props.turnControlsDisabled}
                  enabled={props.fastModeEnabled}
                  onChange={props.onFastModeChange}
                />
              ) : null}
            </PromptInputTools>
            {/* 模型与提交动作保持固定分组，避免内容宽度变化时拆成两行。 */}
            <div className="flex min-w-0 items-center gap-1 max-workbench:shrink-0 max-workbench:gap-0.5 max-[360px]:!gap-0">
              <ComposerModelSelector
                activeSettings={props.activeSettings}
                disabled={props.turnControlsDisabled}
                models={props.models}
                modelsPending={props.modelsPending}
                onSettingsChange={props.onSettingsChange}
                selectedModel={props.selectedModel}
                selectedReasoningEffort={props.selectedReasoningEffort}
              />
              <PromptInputSubmit
                aria-label={
                  props.submitAction === "queue"
                    ? t("composer.queueMessage")
                    : props.submitAction === "steer"
                      ? t("composer.sendSteer")
                      : props.submitAction === "interrupt"
                        ? t("composer.stop")
                        : t("composer.submit")
                }
                disabled={
                  props.turnControlsDisabled ||
                  props.submitAction === "blocked" ||
                  (props.submitAction === "start" &&
                    (!props.canSubmit ||
                      props.selectedModel === undefined ||
                      props.selectedReasoningEffort === undefined)) ||
                  (props.submitAction === "interrupt" &&
                    (!props.canInterrupt || props.activeTurnId === undefined))
                }
                className="max-workbench:w-8 max-workbench:min-w-8 max-[360px]:!w-6 max-[360px]:!min-w-6"
                onClick={props.submitAction === "interrupt" ? props.onInterrupt : undefined}
                status={props.state === "running" && props.hasComposerInput ? "idle" : props.state}
                type={props.submitAction === "interrupt" ? "button" : "submit"}
              />
            </div>
          </PromptInputFooter>
        </PromptInput>
      </div>
      {props.modelsError === null ? null : (
        <p className="mx-auto mt-1 w-full max-w-content px-1 text-caption text-danger" role="alert">
          {t("composer.modelListFailed")}
        </p>
      )}
      <div className="mx-auto mt-1.5 flex h-9 w-full max-w-content min-w-0 items-center gap-3 px-1 text-caption text-muted-foreground">
        {props.projectToolsEnabled ? (
          <>
            <div className="flex min-w-0 shrink items-center gap-0.5">
              <ComposerBranchSwitcher
                creatingBranch={props.creatingBranch}
                creatingWorktree={props.creatingWorktree}
                gitStatus={props.gitStatus}
                onBranchChange={props.onBranchChange}
                onBranchCreate={props.onBranchCreate}
                onWorktreeChange={props.onWorktreeChange}
                onWorktreeCreate={props.onWorktreeCreate}
                switchingBranch={props.switchingBranch}
                switchingWorktree={props.switchingWorktree}
                worktrees={props.worktrees}
                worktreesError={props.worktreesError}
                worktreesPending={props.worktreesPending}
              />
            </div>
            {/* 主目录选择与路径保持同一操作区，切换后所有项目视图共享该 rootId。 */}
            <ComposerProjectRootControls
              onOpen={props.onOpenProjectPath}
              onRootChange={props.onProjectRootChange}
              projectPath={props.projectPath}
              projectPathOpenDisabled={props.projectPathOpenDisabled}
              roots={props.projectRoots}
              selectedRootId={props.selectedProjectRootId}
            />
          </>
        ) : null}
        <Context
          className="ml-auto"
          maxTokens={props.contextUsage?.contextWindow}
          usedTokens={props.contextUsage?.usedTokens}
        >
          <ContextTrigger />
        </Context>
      </div>
    </section>
  );
}
