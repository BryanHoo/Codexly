import { Bug, CircleGauge, FilePlus2, GitFork, Lightbulb, Target, X, Zap } from "lucide-react";
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
            className="size-3 shrink-0 opacity-0 transition-opacity group-hover/composer-mode:opacity-100 group-focus-visible/composer-mode:opacity-100"
          />
        </PromptInputButton>
      </TooltipTrigger>
      <TooltipContent>{cancelLabel}</TooltipContent>
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
