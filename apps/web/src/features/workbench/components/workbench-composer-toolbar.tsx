import { ComposerToolbar } from "@codexly/ui/core/composer-toolbar";
import type { ReactNode } from "react";
import { ComposerModelSelector } from "./composer-model-selector.js";
import { ComposerApprovalControls } from "./workbench-composer-approval-controls.js";
import type { WorkbenchComposerViewProps } from "./workbench-composer-view-contracts.js";
import type { AgentGoal } from "@codexly/protocol";
import {
  Bookmark,
  Bug,
  CircleGauge,
  FilePlus2,
  GitFork,
  Lightbulb,
  Target,
  X,
  Zap,
} from "lucide-react";
import type { PromptCommandAction } from "./prompt-command.js";
import type { ComposerMode } from "./workbench-composer-contracts.js";

import { useTranslation } from "../../../i18n/i18n.js";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "../../../shared/components/agent/attachments.js";
import {
  PromptInputButton,
  PromptInputHeader,
  usePromptInputAttachments,
} from "../../../shared/components/agent/prompt-input.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";

export function PromptCommandIcon({ action }: Readonly<{ action: PromptCommandAction }>) {
  const className = "size-4 shrink-0 text-brand";
  switch (action) {
    case "saved-prompt":
      return <Bookmark aria-hidden="true" className={className} />;
    case "review":
      return <Bug aria-hidden="true" className={className} />;
    case "initialize":
      return <FilePlus2 aria-hidden="true" className={className} />;
    case "compact":
      return <CircleGauge aria-hidden="true" className={className} />;
    case "fork":
      return <GitFork aria-hidden="true" className={className} />;
    case "plan":
      return <Lightbulb aria-hidden="true" className={className} />;
    case "goal":
      return <Target aria-hidden="true" className={className} />;
  }
}

export function ComposerModeTag({
  disabled,
  mode,
  onRemove,
}: Readonly<{ disabled: boolean; mode: ComposerMode; onRemove: () => void }>) {
  const { t } = useTranslation("workbench");
  const isGoal = mode === "goal";
  const label = t(isGoal ? "composer.goalMode" : "composer.planMode");
  const cancelLabel = t(isGoal ? "composer.cancelGoalMode" : "composer.cancelPlanMode");
  const ModeIcon = isGoal ? Target : Lightbulb;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <PromptInputButton
          aria-label={cancelLabel}
          className="group/composer-mode gap-1 px-1.5 text-foreground max-workbench:gap-0.5"
          {...(isGoal ? { "data-goal-mode": "" } : { "data-plan-mode": "" })}
          disabled={disabled}
          onClick={onRemove}
        >
          <ModeIcon aria-hidden="true" className="size-3.5 shrink-0 text-brand" />
          <span className="max-workbench:hidden">{label}</span>
          <X
            aria-hidden="true"
            className="size-3 shrink-0 touch-visible-action opacity-0 transition-opacity group-hover/composer-mode:opacity-100 group-focus-visible/composer-mode:opacity-100"
          />
        </PromptInputButton>
      </TooltipTrigger>
      <TooltipContent>{cancelLabel}</TooltipContent>
    </Tooltip>
  );
}

export function ComposerGoalStatusTag({ goal }: Readonly<{ goal: AgentGoal }>) {
  const { t } = useTranslation("workbench");
  // 已完成目标仅作为历史信息保留，不再占用后续普通 Turn 的输入框状态位。
  if (goal.status === "complete") {
    return null;
  }
  const label = t(`composer.goalStatus.${goal.status}`);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={t("composer.goalStatusLabel", {
            objective: goal.objective,
            status: label,
          })}
          className="inline-flex h-8 min-w-0 items-center gap-1 px-1.5 text-body-small text-foreground max-workbench:gap-0.5"
          data-goal-status={goal.status}
        >
          <Target aria-hidden="true" className="size-3.5 shrink-0 text-brand" />
          <span className="max-workbench:hidden">{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 break-words">{goal.objective}</TooltipContent>
    </Tooltip>
  );
}

export function ComposerFastModeButton({
  disabled,
  enabled,
  onChange,
}: Readonly<{ disabled: boolean; enabled: boolean; onChange: (enabled: boolean) => void }>) {
  const { t } = useTranslation("workbench");
  const label = t(enabled ? "composer.disableFastMode" : "composer.enableFastMode");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <PromptInputButton
          aria-label={label}
          aria-pressed={enabled}
          className={enabled ? "text-brand" : "text-muted-foreground"}
          data-fast-mode=""
          disabled={disabled}
          onClick={() => {
            onChange(!enabled);
          }}
        >
          <Zap aria-hidden="true" className="size-3.5" />
        </PromptInputButton>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ComposerAttachments() {
  const { t } = useTranslation("workbench");
  const attachments = usePromptInputAttachments();
  if (attachments.files.length === 0) {
    return null;
  }
  return (
    <PromptInputHeader>
      <Attachments aria-label={t("composer.addedAttachments")}>
        {attachments.files.map((attachment) => (
          <Attachment
            data={attachment}
            key={attachment.id}
            onRemove={() => {
              attachments.remove(attachment.id);
            }}
          >
            <AttachmentPreview />
            <AttachmentInfo />
            <AttachmentRemove disabled={attachments.disabled} />
          </Attachment>
        ))}
      </Attachments>
    </PromptInputHeader>
  );
}

/** 保留字段的原有顺序与左右分组；收起优先级仅用于空间不足时的取舍。 */
export function ComposerConfigurationToolbar({
  props,
  leading,
  children,
}: Readonly<{
  props: WorkbenchComposerViewProps;
  leading: ReactNode;
  children: ReactNode;
}>) {
  const { t } = useTranslation(["workbench", "settings"]);
  const modelProps = {
    activeSettings: props.activeSettings,
    disabled: props.turnControlsDisabled,
    models: props.models,
    modelsPending: props.modelsPending,
    onSettingsChange: props.onSettingsChange,
    selectedModel: props.selectedModel,
    selectedReasoningEffort: props.selectedReasoningEffort,
  };
  const approvalProps = {
    disabled: props.turnControlsDisabled,
    onSettingsChange: props.onSettingsChange,
    sandboxModeSelectable: props.sandboxModeSelectable,
    settings: props.activeSettings,
  };
  return (
    <ComposerToolbar
      moreLabel={t("composer.moreSettings")}
      title={t("composer.settingsTitle")}
      leading={leading}
      model={<ComposerModelSelector {...modelProps} control="model" />}
      items={[
        { id: "engine", priority: 30, label: t("engine.select"), control: props.engineControls },
        {
          id: "approval",
          priority: 20,
          label: t(
            props.activeSettings.engineOptions?.engine === "claude"
              ? "engine.permissions"
              : "composer.approvalMode",
          ),
          control: <ComposerApprovalControls {...approvalProps} control="approval" />,
        },
        ...(props.sandboxModeSelectable && props.activeSettings.engineOptions?.engine !== "claude"
          ? [
              {
                id: "sandbox",
                priority: 10,
                label: t("composer.sandboxMode"),
                control: <ComposerApprovalControls {...approvalProps} control="sandbox" />,
              },
            ]
          : []),
        ...(props.composerMode === undefined
          ? []
          : [
              {
                id: "mode",
                pinned: true,
                label: t(props.composerMode === "goal" ? "composer.goalMode" : "composer.planMode"),
                control: (
                  <ComposerModeTag
                    disabled={props.turnControlsDisabled}
                    mode={props.composerMode}
                    onRemove={props.onComposerModeRemove}
                  />
                ),
              },
            ]),
        ...(props.goal === null || props.goal === undefined || props.goal.status === "complete"
          ? []
          : [
              {
                id: "goal",
                priority: 80,
                label: t("composer.goalMode"),
                control: <ComposerGoalStatusTag goal={props.goal} />,
              },
            ]),
        ...(props.fastModeAvailable
          ? [
              {
                id: "fast",
                priority: 70,
                label: t("composer.fastMode"),
                control: (
                  <ComposerFastModeButton
                    disabled={props.turnControlsDisabled}
                    enabled={props.fastModeEnabled}
                    onChange={props.onFastModeChange}
                  />
                ),
              },
            ]
          : []),
        ...(props.selectedModel?.supportedReasoningEfforts.length
          ? [
              {
                id: "reasoning",
                // 思考量与模型共同常驻右侧，不能因中栏变窄被收进配置面板。
                pinned: true,
                trailing: true,
                label: t("composer.reasonEffortSelect"),
                control: <ComposerModelSelector {...modelProps} control="reasoning" />,
              },
            ]
          : []),
      ]}
      actions={children}
    />
  );
}
