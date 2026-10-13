import type {
  GitActionLabels,
  GitCommitAction,
  GitPushStatus,
} from "@codexly/frontend-core/project-git-actions";
import { Check, ChevronDown, GitCommitHorizontal, LoaderCircle, Upload } from "lucide-react";
import { Button } from "./button.js";
import { ButtonGroup } from "./button-group.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";

type CommitAction = GitCommitAction;
type BusyAction = CommitAction | "push" | "generate" | null;

/** 根据用户当前能完成的任务选择唯一主操作，其他 Git 动作保留在同一行菜单中。 */
export function GitChangesActions({
  busyAction,
  canCommit,
  commitSha,
  hasChanges,
  isPending,
  labels,
  onCommit,
  onPush,
  pushStatus,
}: Readonly<{
  busyAction: BusyAction;
  canCommit: boolean;
  commitSha: string | undefined;
  hasChanges: boolean;
  isPending: boolean;
  labels: GitActionLabels;
  onCommit: (action: CommitAction) => void;
  onPush: () => void;
  pushStatus: GitPushStatus | null;
}>) {
  const pushFailed = pushStatus === "failed" || pushStatus === "not_configured";
  const canPush = !isPending && pushStatus !== "pushed";
  const pushLabel =
    pushStatus === "pushed" ? labels.pushed : pushFailed ? labels.pushAgain : labels.push;
  const busyLabel =
    busyAction === "commit_and_push"
      ? labels.committingAndPushing
      : busyAction === "commit"
        ? labels.committing
        : busyAction === "push"
          ? labels.pushing
          : labels.generatingMessage;
  const status =
    pushStatus === "pushed"
      ? labels.pushedToRemote
      : pushFailed
        ? commitSha === undefined
          ? labels.pushFailed
          : labels.savedButPushFailed
        : commitSha === undefined
          ? null
          : labels.savedLocally;

  return (
    <div className={hasChanges ? "mt-2" : ""} data-slot="git-changes-actions">
      {hasChanges ? null : (
        <div className="mb-3 space-y-1">
          <p className="text-label font-medium">{labels.emptyWorkingTree}</p>
          {pushStatus === "pushed" ? null : (
            <p className="text-caption text-muted-foreground">
              {labels.emptyWorkingTreeDescription}
            </p>
          )}
        </div>
      )}
      <ButtonGroup className="w-full">
        {/* 禁用时保留主色并恢复指针命中，让悬停显示禁止操作光标；原生 disabled 继续阻止提交。 */}
        <Button
          aria-label={isPending ? busyLabel : hasChanges ? labels.commit : pushLabel}
          className={
            hasChanges
              ? "min-w-0 flex-1 rounded-r-none disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-100 disabled:hover:bg-brand disabled:active:brightness-100"
              : "w-full"
          }
          disabled={hasChanges ? !canCommit : !canPush}
          onClick={() => {
            if (hasChanges) onCommit("commit");
            else onPush();
          }}
          type="button"
        >
          {isPending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : hasChanges ? (
            <GitCommitHorizontal aria-hidden="true" />
          ) : pushStatus === "pushed" ? (
            <Check aria-hidden="true" />
          ) : (
            <Upload aria-hidden="true" />
          )}
          {isPending ? busyLabel : hasChanges ? labels.commit : pushLabel}
        </Button>
        {hasChanges ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* 推送已有提交不依赖 message；主提交尚不可用时仍允许打开菜单。 */}
              <Button
                aria-label={labels.moreGitActions}
                className="w-9 shrink-0 rounded-l-none border-l border-brand-contrast/30 px-0 disabled:opacity-100"
                disabled={isPending}
                type="button"
              >
                <ChevronDown aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-w-[calc(100vw-1rem)]">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  // Radix 已用背景表示键盘焦点，局部覆盖全局蓝色 outline，保留清晰的选中反馈。
                  className="focus-visible:!outline-none focus-visible:shadow-none"
                  disabled={!canCommit}
                  onSelect={() => {
                    onCommit("commit_and_push");
                  }}
                >
                  <GitCommitHorizontal aria-hidden="true" className="size-4" />
                  <div className="min-w-0">
                    <p>{labels.commitAndPush}</p>
                    <p className="mt-0.5 text-caption text-muted-foreground">
                      {labels.commitAndPushDescription}
                    </p>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="focus-visible:!outline-none focus-visible:shadow-none"
                  disabled={!canPush}
                  onSelect={onPush}
                >
                  <Upload aria-hidden="true" className="size-4" />
                  <div className="min-w-0">
                    <p>{labels.pushExistingCommits}</p>
                    <p className="mt-0.5 text-caption text-muted-foreground">
                      {labels.pushExistingDescription}
                    </p>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </ButtonGroup>
      {status === null ? null : (
        <div
          className={`mt-2 space-y-1 text-caption ${pushFailed ? "text-warning" : "text-muted-foreground"}`}
          role="status"
        >
          <p>
            {status}
            {commitSha === undefined ? null : (
              <code className="ml-1.5 font-mono">{commitSha.slice(0, 7)}</code>
            )}
          </p>
          {pushStatus === "not_configured" ? <p>{labels.pushUpstreamMissing}</p> : null}
        </div>
      )}
    </div>
  );
}
