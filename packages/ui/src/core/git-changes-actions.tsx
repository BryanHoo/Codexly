import type { GitActionLabels, GitCommitAction } from "@codexly/frontend-core/project-git-actions";
import { ChevronDown, GitCommitHorizontal, LoaderCircle } from "lucide-react";
import { Button } from "./button.js";
import { ButtonGroup } from "./button-group.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";

/** 底部只承载提交动作；独立推送与远端进度统一由顶部远端区域展示。 */
export function GitChangesActions({
  busyAction,
  canCommit,
  disabled,
  isPending,
  labels,
  onCommit,
}: Readonly<{
  busyAction: GitCommitAction | null;
  canCommit: boolean;
  disabled: boolean;
  isPending: boolean;
  labels: GitActionLabels;
  onCommit: (action: GitCommitAction) => void;
}>) {
  const label = isPending
    ? busyAction === "commit_and_push"
      ? labels.committingAndPushing
      : labels.committing
    : labels.commit;
  return (
    <div className="mt-2" data-slot="git-changes-actions">
      <ButtonGroup className="w-full">
        {/* 禁用时保留主色并恢复指针命中，让悬停显示禁止操作光标；原生 disabled 继续阻止提交。 */}
        <Button
          aria-label={label}
          className="min-w-0 flex-1 rounded-r-none disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-100 disabled:hover:bg-brand disabled:active:brightness-100"
          disabled={!canCommit}
          onClick={() => {
            onCommit("commit");
          }}
          type="button"
        >
          {isPending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <GitCommitHorizontal aria-hidden="true" />
          )}
          {label}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={labels.moreGitActions}
              className="w-9 shrink-0 rounded-l-none border-l border-brand-contrast/30 px-0 disabled:opacity-100"
              disabled={disabled}
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
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
    </div>
  );
}
