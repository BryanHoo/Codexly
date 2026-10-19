import * as Popover from "radix-ui/popover";
import { useEffect, useRef, useState } from "react";
import type { ProjectGitWorktreePage } from "@codexly/protocol";
import type { ComposerBranchSwitcherProps, ComposerGitLabels } from "./composer-git-contracts.js";
import { ComposerGitPicker } from "./composer-git-picker.js";
import { CreateWorktreeDialog } from "./create-worktree-dialog.js";

export function ComposerGitMenu({
  workspace,
  gitStatus,
  onBranchChange,
  onBranchCreate,
  creatingBranch,
  pending,
  open,
  labels,
  onError,
  onOpenChange,
  restoreFocus,
}: ComposerBranchSwitcherProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restoreFocus: () => void;
  pending: boolean;
  labels: ComposerGitLabels;
  onError: (error: unknown) => void;
}) {
  const [dialog, setDialog] = useState<{ kind: "branch" | "worktree"; initialBranch: string }>();
  const [creating, setCreating] = useState(false);
  const lock = useRef(false);
  const openingDialog = useRef(false);
  const [result, setResult] = useState<{
    scope: string;
    data?: ProjectGitWorktreePage;
    error?: Error;
  }>();
  const [revision, setRevision] = useState(0);
  const scope = JSON.stringify([workspace?.projectId, workspace?.rootPath]);
  const worktrees = result?.scope === scope ? result : undefined;
  useEffect(() => {
    if (!open || !workspace) return;
    let active = true;
    // 菜单展开才读取一次 Git 列表；切换目录或卸载后忽略旧请求，不增加后台轮询。
    void workspace.client.listProjectWorktrees(workspace.projectId, workspace.rootPath).then(
      (data) => {
        if (active) setResult({ scope, data });
      },
      (error: unknown) => {
        if (active)
          setResult({
            scope,
            error: error instanceof Error ? error : new Error("Git worktree list failed"),
          });
      },
    );
    return () => {
      active = false;
    };
  }, [open, workspace?.client, workspace?.projectId, workspace?.rootPath, scope, revision]);
  const create = async (branch: string) => {
    if (dialog?.kind === "branch") return onBranchCreate(branch);
    if (!workspace || lock.current) return false;
    lock.current = true;
    setCreating(true);
    try {
      const status = await workspace.client.getProjectGitStatus(workspace.projectId, {
        rootPath: workspace.rootPath,
      });
      // 只创建 Git 检出，不注册额外项目、不创建任务，也不读取模型或引擎配置。
      const { worktree } = await workspace.client.createTaskWorktree(
        workspace.projectId,
        workspace.rootPath,
        { branch, expectedSnapshot: status.snapshot },
      );
      workspace.select(worktree.path);
      return true;
    } catch (error) {
      onError(error);
      return false;
    } finally {
      lock.current = false;
      setCreating(false);
    }
  };
  return (
    <>
      {open ? (
        <Popover.Portal>
          <Popover.Content
            align="start"
            aria-label={labels.pickerTitle}
            side="top"
            sideOffset={6}
            collisionPadding={8}
            className="z-50 flex max-h-[min(26rem,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-surface bg-raised text-foreground shadow-floating outline-none"
            onCloseAutoFocus={(event) => {
              // 创建表单接管焦点；同步标记避免卸载后的浮层把焦点抢回入口。
              if (openingDialog.current) event.preventDefault();
            }}
          >
            <ComposerGitPicker
              labels={labels}
              branches={gitStatus?.branches ?? []}
              branch={gitStatus?.branch ?? null}
              rootPath={workspace?.rootPath}
              worktrees={worktrees?.data?.worktrees}
              hasWorkspace={workspace !== undefined}
              error={worktrees?.error !== undefined}
              pending={pending}
              onRetry={() => {
                setResult(undefined);
                setRevision((value) => value + 1);
              }}
              onSelectWorktree={(path) => {
                workspace?.select(path);
                onOpenChange(false);
              }}
              onSelectBranch={(branch) => {
                onBranchChange(branch);
                onOpenChange(false);
              }}
              onCreate={(kind, initialBranch) => {
                openingDialog.current = true;
                setDialog({ kind, initialBranch });
                onOpenChange(false);
              }}
            />
          </Popover.Content>
        </Popover.Portal>
      ) : null}
      {dialog ? (
        <CreateWorktreeDialog
          initialBranch={dialog.initialBranch}
          restoreFocus={restoreFocus}
          context={{
            branch: gitStatus?.branch ?? labels.missing,
            branchLabel: labels.baseBranch,
            locationLabel: labels.location,
            ...(dialog.kind === "worktree"
              ? {
                  location: `${worktrees?.data?.worktrees[0]?.path ?? workspace?.rootPath ?? ""}/.worktree/`,
                }
              : {}),
          }}
          isPending={creating || creatingBranch !== undefined}
          onClose={() => {
            openingDialog.current = false;
            setDialog(undefined);
          }}
          onCreate={create}
          labels={{
            title: dialog.kind === "branch" ? labels.createBranch : labels.createWorktree,
            description:
              dialog.kind === "branch" ? labels.branchDescription : labels.worktreeDescription,
            branch: labels.branchName,
            cancel: labels.cancel,
            create:
              dialog.kind === "branch" ? labels.createBranchConfirm : labels.createWorktreeConfirm,
          }}
        />
      ) : null}
    </>
  );
}
