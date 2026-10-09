import { useRevealSplitComposer } from "@codexly/ui/core/split-composer";
import type { ReactNode } from "react";
import { Context, ContextTrigger } from "../../../shared/components/agent/context.js";
import { TerminalFooter } from "../../terminal/components/terminal-context.js";
import { TerminalStatusTrigger } from "../../terminal/components/terminal-status-trigger.js";
import { ComposerBranchSwitcher } from "./composer-branch-switcher.js";
import { ProjectDraftList } from "./project-draft-controls.js";
import type { WorkbenchComposerViewProps } from "./workbench-composer-view-contracts.js";

export function WorkbenchComposerFooter({ props, rootControls, controls }: { props: WorkbenchComposerViewProps; rootControls: ReactNode; controls: ReactNode }) {
  const revealComposer = useRevealSplitComposer();
  if (!props.footerVisible) return null;
  return <TerminalFooter><div className="mx-auto mt-1.5 flex h-9 w-full max-w-content min-w-0 items-center gap-3 px-1 text-caption text-muted-foreground">
    {props.projectToolsEnabled ? <>
      <div className="flex min-w-0 shrink items-center gap-0.5"><ComposerBranchSwitcher
        creatingBranch={props.creatingBranch} gitStatus={props.gitStatus}
        onBranchChange={props.onBranchChange} onBranchCreate={props.onBranchCreate}
        switchingBranch={props.switchingBranch}
      /></div>
      {rootControls}
      <TerminalStatusTrigger />
    </> : null}
    <div className="ml-auto flex shrink-0 items-center gap-1">
      {props.captureMode ? null : <ProjectDraftList composerHasInput={props.hasComposerInput} drafts={props.projectDrafts} onDelete={props.onProjectDraftDelete} onRestore={(draftId) => { props.onProjectDraftRestore(draftId); revealComposer?.(); }} projectName={props.projectName} />}
      <Context maxTokens={props.contextUsage?.contextWindow} usedTokens={props.contextUsage?.usedTokens}><ContextTrigger /></Context>
      {controls}
    </div>
  </div></TerminalFooter>;
}
