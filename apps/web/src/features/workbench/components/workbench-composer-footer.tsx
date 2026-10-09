import type { ReactNode } from "react";
import { useRevealSplitComposer } from "@codexly/ui/core/split-composer";
import { Context, ContextTrigger } from "../../../shared/components/agent/context.js";
import { ComposerBranchSwitcher } from "./composer-branch-switcher.js";
import { ProjectTodoList } from "./project-todo-controls.js";
import type { WorkbenchComposerViewProps } from "./workbench-composer-view-contracts.js";

export function WorkbenchComposerFooter({
  props,
  rootControls,
  controls,
}: Readonly<{
  props: WorkbenchComposerViewProps;
  rootControls: ReactNode;
  controls: ReactNode;
}>) {
  const revealComposer = useRevealSplitComposer();
  if (!props.footerVisible) return null;
  return (
    <div className="mx-auto mt-1.5 flex h-9 w-full max-w-content min-w-0 items-center gap-3 px-1 text-caption text-muted-foreground">
      {props.projectToolsEnabled ? (
        <>
          <div className="flex min-w-0 shrink items-center gap-0.5">
            <ComposerBranchSwitcher
              creatingBranch={props.creatingBranch}
              gitStatus={props.gitStatus}
              onBranchChange={props.onBranchChange}
              onBranchCreate={props.onBranchCreate}
              switchingBranch={props.switchingBranch}
            />
          </div>
          {rootControls}
        </>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {props.projectToolsEnabled && !props.captureMode ? (
          <ProjectTodoList
            composerHasInput={props.hasComposerInput}
            onDelete={props.onProjectTodoDelete}
            onRestore={(todoId) => {
              props.onProjectTodoRestore(todoId);
              revealComposer?.();
            }}
            projectName={props.projectName}
            todos={props.projectTodos}
          />
        ) : null}
        <Context
          maxTokens={props.contextUsage?.contextWindow}
          usedTokens={props.contextUsage?.usedTokens}
        >
          <ContextTrigger />
        </Context>
        {controls}
      </div>
    </div>
  );
}
