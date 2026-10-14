import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { List, ListTree, LoaderCircle } from "lucide-react";
import {
  createCommitDraft,
  applyGeneratedCommitMessage,
  type CommitFileEntry,
} from "@codexly/frontend-core/git-commit-draft";
import { createGitActionLabels } from "@codexly/frontend-core/project-git-actions";
import { GitRemoteStatus } from "./git-remote-status.js";
import { classifyGitFailure } from "@codexly/frontend-core/git-recovery";
import { useGitOperationReceipt } from "./use-git-operation-receipt.js";
import type {
  CommitProjectChangesRequest,
  GenerateCommitMessageRequest,
  PushProjectCommitsResponse,
  PushProjectCommitsRequest,
  ProjectGitStatus,
} from "@codexly/frontend-core/git-workspace-contract";
import { Button } from "./button.js";
import { GitChangesActions } from "./git-changes-actions.js";
import { GitCommitEditor, type GitWorkspaceTranslate } from "./git-commit-editor.js";
import { useGitCommitDraft } from "./use-git-commit-draft.js";

export function collectCommitFileEntries(
  status: Pick<ProjectGitStatus, "staged" | "unstaged">,
): readonly CommitFileEntry[] {
  const entries = new Map<string, CommitFileEntry>();
  for (const change of status.staged)
    entries.set(change.path, { path: change.path, staged: true, unstaged: false });
  for (const change of status.unstaged)
    entries.set(change.path, {
      path: change.path,
      staged: entries.has(change.path),
      unstaged: true,
    });
  return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path, "en"));
}

export type GitCommitWorkspaceProps = Readonly<{
  gitStatus: ProjectGitStatus;
  draftScope?: string;
  error?: Error | null;
  isCommitting?: boolean;
  isPushing?: boolean;
  activeRemoteAction?: PushProjectCommitsRequest["action"] | null | undefined;
  isGenerating?: boolean;
  totalChanges?: number | undefined;
  complete?: boolean;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
  onCommit: (request: CommitProjectChangesRequest) => Promise<void>;
  onPush: () => Promise<void>;
  onGenerateMessage: (request: GenerateCommitMessageRequest) => Promise<string>;
  result?: Readonly<{
    commitSha: string;
    pushStatus: "not_requested" | "pushed" | "failed" | "not_configured";
    pushError: string | null;
  }> | null;
  pushResult?: PushProjectCommitsResponse | null;
  remoteResult?: PushProjectCommitsResponse | undefined;
  isInspectingRemote?: boolean;
  onOpenConflict?: ((path: string) => void) | undefined;
  onRemoteAction?: (request: Omit<PushProjectCommitsRequest, "expectedSnapshot">) => Promise<void>;
  t: GitWorkspaceTranslate;
  viewMode: "tree" | "list";
  onViewModeChange: (mode: "tree" | "list") => void;
  renderChanges: (
    selected: ReadonlySet<string>,
    onChange: (paths: Set<string>) => void,
    disabled: boolean,
    search: string,
  ) => ReactNode;
}>;

/** 两端共用工作区；平台仅注入分页、差异读取和文件导航。 */
export function GitCommitWorkspace({
  gitStatus,
  draftScope = "repository",
  error = null,
  isCommitting = false,
  isPushing = false,
  activeRemoteAction,
  isGenerating = false,
  totalChanges,
  complete = true,
  onLoadMore,
  isLoadingMore = false,
  onCommit,
  onPush,
  onGenerateMessage,
  result = null,
  pushResult = null,
  remoteResult,
  isInspectingRemote = false,
  onRemoteAction,
  onOpenConflict,
  t,
  viewMode,
  onViewModeChange,
  renderChanges,
}: GitCommitWorkspaceProps) {
  const entries = useMemo(() => collectCommitFileEntries(gitStatus), [gitStatus]);
  const [draft, update] = useGitCommitDraft(draftScope, gitStatus.snapshot, entries, complete);
  const [search, setSearch] = useState("");
  const [operationError, setOperationError] = useState<{
    message: string;
    operation: "commit" | "generate" | NonNullable<PushProjectCommitsRequest["action"]>;
  } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [commitAction, setCommitAction] = useState<CommitProjectChangesRequest["action"]>("commit");
  const busy = useRef(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const gitBusy = isCommitting || isPushing;
  const hasChanges = (totalChanges ?? entries.length) > 0;
  const pushError = pushResult?.pushError ?? result?.pushError ?? null;
  const receipt = useGitOperationReceipt(
    draftScope,
    pushResult || result
      ? {
          head:
            pushResult?.remoteState?.head ??
            result?.commitSha ??
            remoteResult?.remoteState?.head ??
            null,
          commitSha: result?.commitSha ?? null,
          pushStatus: pushResult?.pushStatus ?? result?.pushStatus ?? "not_requested",
          failureKind: classifyGitFailure(pushError),
        }
      : null,
    remoteResult?.remoteState?.head,
  );
  const pushStatus = pushResult?.pushStatus ?? result?.pushStatus ?? receipt?.pushStatus ?? null;
  const labels = createGitActionLabels((key) => t(key));
  const canCommit =
    remoteResult?.remoteState?.operation !== "merge" &&
    !gitBusy &&
    draft.selectedPaths.size > 0 &&
    draft.message.trim() !== "";
  const runGit = async (
    operation: () => Promise<void>,
    action: "commit" | NonNullable<PushProjectCommitsRequest["action"]> = "push",
  ) => {
    if (busy.current) return false;
    busy.current = true;
    setOperationError(null);
    try {
      await operation();
      return true;
    } catch (cause) {
      setOperationError({
        message: cause instanceof Error ? cause.message : String(cause),
        operation: action,
      });
      return false;
    } finally {
      busy.current = false;
    }
  };
  const generate = async () => {
    if (generating || isGenerating) return;
    const requested = draft;
    const request = ++generation.current;
    setGenerating(true);
    setOperationError(null);
    try {
      const message = await onGenerateMessage({
        expectedSnapshot: requested.snapshot,
        paths: [...requested.selectedPaths],
      });
      if (generation.current === request)
        update((current) => applyGeneratedCommitMessage(current, requested, message));
    } catch (cause) {
      if (generation.current === request)
        setOperationError({
          message: cause instanceof Error ? cause.message : String(cause),
          operation: "generate",
        });
    } finally {
      if (generation.current === request) setGenerating(false);
    }
  };
  const commit = (action: CommitProjectChangesRequest["action"]) =>
    runGit(async () => {
      setCommitAction(action);
      await onCommit({
        action,
        expectedSnapshot: gitStatus.snapshot,
        paths: [...draft.selectedPaths],
        message: draft.message,
      });
      generation.current++;
      setGenerating(false);
      // 只有提交完成才清理已用草稿；新出现的变更需要用户重新选择。
      update((current) => ({
        ...createCommitDraft(current.snapshot, []),
        knownPaths: current.knownPaths,
      }));
    }, "commit");
  if (gitStatus.repositoryMode !== "root") return null;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-slot="commit-changes-panel">
      <GitRemoteStatus
        branch={gitStatus.branch}
        remote={remoteResult?.remoteState}
        pushStatus={pushStatus}
        pushError={pushError}
        commitSha={result?.commitSha ?? receipt?.commitSha ?? undefined}
        savedFailureKind={receipt?.failureKind}
        busy={gitBusy}
        activeAction={isPushing ? (activeRemoteAction ?? "push") : null}
        actionError={operationError?.message ?? (pushError ? null : (error?.message ?? null))}
        failureOperation={operationError?.operation ?? (!pushError && error ? "status" : undefined)}
        inspecting={isInspectingRemote}
        onOpenConflict={onOpenConflict}
        t={t}
        onPush={() => {
          void runGit(onPush);
        }}
        {...(onRemoteAction
          ? {
              onAction: (request: Omit<PushProjectCommitsRequest, "expectedSnapshot">) =>
                runGit(() => onRemoteAction(request), request.action ?? "push"),
            }
          : {})}
      />
      {hasChanges ? (
        <>
          <div className="max-h-[25%] shrink-0 space-y-2 overflow-y-auto px-3 py-2">
            <div className="flex items-center gap-1">
              <p className="min-w-0 flex-1 text-caption font-semibold">
                {t("commit.selectedFiles", {
                  selected: draft.selectedPaths.size,
                  total: totalChanges ?? entries.length,
                })}
              </p>
              <Button
                size="icon-sm"
                variant="ghost"
                type="button"
                aria-label={t(viewMode === "tree" ? "diff.showFileList" : "diff.showFileTree")}
                onClick={() => {
                  onViewModeChange(viewMode === "tree" ? "list" : "tree");
                }}
              >
                {viewMode === "tree" ? (
                  <List className="size-3.5" />
                ) : (
                  <ListTree className="size-3.5" />
                )}
              </Button>
            </div>
            <input
              aria-label={t("commit.searchFiles")}
              placeholder={t("commit.searchFiles")}
              className="h-8 w-full rounded-control border border-separator bg-panel px-2 text-label outline-none focus-visible:shadow-focus"
              value={search}
              onChange={(event) => {
                setSearch(event.currentTarget.value);
              }}
            />
            {entries.some((entry) => entry.staged && entry.unstaged) ? (
              <p className="text-caption text-muted-foreground">{t("commit.partialStaged")}</p>
            ) : null}
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {renderChanges(
              draft.selectedPaths,
              (paths) => {
                update((current) => ({
                  ...current,
                  selectedPaths: paths,
                }));
              },
              gitBusy,
              search,
            )}
          </div>
          {!complete ? (
            <div className="shrink-0 border-t border-separator px-3 py-1">
              <Button
                size="sm"
                variant="ghost"
                className="w-full"
                disabled={isLoadingMore}
                onClick={onLoadMore}
                type="button"
              >
                {isLoadingMore ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                {t("commit.loadMore")} · {entries.length} / {totalChanges ?? entries.length}
              </Button>
            </div>
          ) : null}
          <section
            className="max-h-[60%] min-h-0 shrink space-y-2 overflow-y-auto border-t border-separator px-3 py-2"
            data-slot="git-commit-footer"
          >
            <GitCommitEditor
              draft={draft}
              update={update}
              generating={generating || isGenerating}
              disabled={isCommitting}
              canGenerate={draft.selectedPaths.size > 0 && !gitBusy}
              onGenerate={() => {
                void generate();
              }}
              t={t}
            />
            <GitChangesActions
              busyAction={isCommitting ? commitAction : null}
              canCommit={canCommit}
              isPending={isCommitting}
              disabled={gitBusy}
              labels={labels}
              onCommit={(action) => {
                void commit(action);
              }}
            />
          </section>
        </>
      ) : null}
    </div>
  );
}
