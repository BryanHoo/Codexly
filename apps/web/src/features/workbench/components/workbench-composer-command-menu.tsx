import { Bug, GitBranch, Sparkles } from "lucide-react";

import { useTranslation } from "../../../i18n/i18n.js";
import {
  PromptInputCommand,
  PromptInputCommandEmpty,
  PromptInputCommandGroup,
  PromptInputCommandItem,
  PromptInputCommandList,
} from "../../../shared/components/agent/prompt-input.js";
import { PromptCommandIcon } from "./workbench-composer-toolbar.js";
import type { WorkbenchComposerViewProps } from "./workbench-composer-view-contracts.js";

export function ComposerCommandMenu({ props }: Readonly<{ props: WorkbenchComposerViewProps }>) {
  const { t } = useTranslation("workbench");
  return !props.commandMenuOpen || props.turnControlsDisabled ? null : (
    <PromptInputCommand
      aria-label={t("composer.commandInput")}
      className="absolute inset-x-0 bottom-full z-20 mb-2"
      id={props.commandMenuId}
    >
      <PromptInputCommandList>
        {props.reviewMenuMode === "scopes" ? (
          <PromptInputCommandGroup label={t("composer.reviewScopeGroup")}>
            <PromptInputCommandItem
              active={props.activeCommandIndex === 0}
              id={`${props.commandMenuId}-item-0`}
              onClick={() => {
                props.onExecuteReview({ type: "uncommitted_changes" });
              }}
            >
              <Bug aria-hidden="true" className="size-4 shrink-0 text-brand" />
              <span className="font-medium">{t("composer.reviewUncommitted")}</span>
            </PromptInputCommandItem>
            <PromptInputCommandItem
              active={props.activeCommandIndex === 1}
              aria-description={
                props.baseBranches.length === 0 ? t("composer.noBaseBranch") : props.baseBranches[0]
              }
              disabled={props.baseBranches.length === 0}
              id={`${props.commandMenuId}-item-1`}
              onClick={props.onOpenReviewBranches}
            >
              <GitBranch aria-hidden="true" className="size-4 shrink-0 text-brand" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{t("composer.baseBranchReview")}</span>
                <span className="truncate text-caption text-muted-foreground">
                  {props.baseBranches[0] ?? t("composer.noBaseBranch")}
                </span>
              </span>
            </PromptInputCommandItem>
          </PromptInputCommandGroup>
        ) : props.reviewMenuMode === "branches" ? (
          <PromptInputCommandGroup label={t("composer.reviewBaseBranchGroup")}>
            {props.baseBranches.map((branch, index) => (
              <PromptInputCommandItem
                active={props.activeCommandIndex === index}
                id={`${props.commandMenuId}-item-${String(index)}`}
                key={branch}
                onClick={() => {
                  props.onExecuteReview({ branch, type: "base_branch" });
                }}
              >
                <GitBranch aria-hidden="true" className="size-4 shrink-0 text-brand" />
                <span className="truncate font-medium">{branch}</span>
              </PromptInputCommandItem>
            ))}
          </PromptInputCommandGroup>
        ) : (
          <>
            <PromptInputCommandGroup label={t("composer.commandGroup")}>
              {props.filteredCommands.map((command, index) => {
                const availability = props.getCommandAvailability(command);
                return (
                  <PromptInputCommandItem
                    active={index === props.activeCommandIndex}
                    aria-description={availability.reason}
                    disabled={!availability.available}
                    id={`${props.commandMenuId}-item-${String(index)}`}
                    key={command.id}
                    onClick={() => {
                      props.onExecuteCommand(command);
                    }}
                  >
                    <PromptCommandIcon action={command.action} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium">{command.label}</span>
                      <span className="text-caption text-muted-foreground">
                        {availability.reason ?? command.description}
                      </span>
                    </span>
                  </PromptInputCommandItem>
                );
              })}
            </PromptInputCommandGroup>
            {props.filteredSkills.length === 0 ? null : (
              <PromptInputCommandGroup label="Skills">
                {props.filteredSkills.map((skill, index) => {
                  const menuIndex = props.filteredCommands.length + index;
                  return (
                    <PromptInputCommandItem
                      active={menuIndex === props.activeCommandIndex}
                      id={`${props.commandMenuId}-item-${String(menuIndex)}`}
                      key={skill.id}
                      onClick={() => {
                        props.onSelectSkill(skill);
                      }}
                    >
                      <Sparkles aria-hidden="true" className="size-4 shrink-0 text-brand" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="font-medium text-brand">{skill.displayName}</span>
                        <span className="block max-w-full truncate text-caption text-muted-foreground">
                          /{skill.name} · {skill.description}
                        </span>
                      </span>
                    </PromptInputCommandItem>
                  );
                })}
              </PromptInputCommandGroup>
            )}
            {props.menuItemCount === 0 ? (
              <PromptInputCommandEmpty>{t("composer.commandNoMatch")}</PromptInputCommandEmpty>
            ) : null}
          </>
        )}
      </PromptInputCommandList>
    </PromptInputCommand>
  );
}
