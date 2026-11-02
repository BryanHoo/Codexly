import { Bug, GitBranch, Sparkles } from "lucide-react";

import type { AgentReviewTarget, AgentSkill } from "@codexly/protocol";
import type { ComponentType } from "react";
import {
  PromptInputCommand,
  PromptInputCommandEmpty,
  PromptInputCommandGroup,
  PromptInputCommandItem,
  PromptInputCommandList,
} from "../agent/prompt-input-controls.js";
type MenuCommand = Readonly<{ action: string; id: string; label: string; description: string }>;

export type ComposerCommandMenuTranslationKey =
  | "composer.commandInput"
  | "composer.reviewScopeGroup"
  | "composer.reviewUncommitted"
  | "composer.noBaseBranch"
  | "composer.baseBranchReview"
  | "composer.reviewBaseBranchGroup"
  | "composer.savedPromptGroup"
  | "composer.commandGroup"
  | "composer.commandNoMatch"
  | "composer.commandLimitHint";

// 只约束菜单实际消费的字段，避免共享 UI 依赖整份工作台状态或平台命令类型。
export type ComposerCommandMenuProps<Command extends MenuCommand> = Readonly<{
  activeCommandIndex: number;
  baseBranches: readonly string[];
  commandMenuId: string;
  commandMenuOpen: boolean;
  filteredCommands: readonly Command[];
  filteredSkills: readonly AgentSkill[];
  getCommandAvailability: (command: Command) => Readonly<{ available: boolean; reason?: string }>;
  menuItemCount: number;
  onExecuteCommand: (command: Command) => void;
  onExecuteReview: (target: AgentReviewTarget) => void;
  onOpenReviewBranches: () => void;
  onSelectSkill: (skill: AgentSkill) => void;
  reviewMenuMode: "branches" | "scopes" | null;
  turnControlsDisabled: boolean;
}>;

export function ComposerCommandMenu<Command extends MenuCommand>({
  props,
  t,
  CommandIcon,
}: Readonly<{
  props: ComposerCommandMenuProps<Command>;
  t: (key: ComposerCommandMenuTranslationKey) => string;
  CommandIcon: ComponentType<{ action: Command["action"] }>;
}>) {
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
            {[true, false].map((saved) =>
              props.filteredCommands.some(
                (command) => (command.action === "saved-prompt") === saved,
              ) ? (
                <PromptInputCommandGroup
                  key={String(saved)}
                  label={t(saved ? "composer.savedPromptGroup" : "composer.commandGroup")}
                >
                  {props.filteredCommands.map((command, index) => {
                    if ((command.action === "saved-prompt") !== saved) return null;
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
                        <CommandIcon action={command.action} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="font-medium">{command.label}</span>
                          <span className="truncate text-caption text-muted-foreground">
                            {availability.reason ?? command.description}
                          </span>
                        </span>
                      </PromptInputCommandItem>
                    );
                  })}
                </PromptInputCommandGroup>
              ) : null,
            )}
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
      {props.reviewMenuMode === null ? (
        <p className="border-t border-separator px-3 py-2 text-caption text-muted-foreground">
          {t("composer.commandLimitHint")}
        </p>
      ) : null}
    </PromptInputCommand>
  );
}
