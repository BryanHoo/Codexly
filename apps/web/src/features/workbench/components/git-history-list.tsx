import type { ProjectGitCommit, ProjectGitHistoryPage } from "@codexly/protocol";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Copy, GitCommitHorizontal, LoaderCircle } from "lucide-react";
import { useEffect, useMemo } from "react";

import { i18n, useTranslation } from "../../../i18n/i18n.js";
import { cn } from "../../../shared/lib/utils.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../../../shared/components/core/context-menu.js";
import type { CodexlyGitHistoryClient } from "../../projects/project-queries.js";
import { projectGitHistoryInfiniteQueryOptions } from "../../projects/project-queries.js";

export type GitHistoryQueryState = Readonly<{
  data: Readonly<{ pages: readonly ProjectGitHistoryPage[] }> | undefined;
  error: Error | null;
  fetchNextPage: () => unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isPending: boolean;
  refetch: () => unknown;
}>;

type GitHistoryContentProps = Readonly<{
  active: boolean;
  className?: string;
  compact?: boolean;
  dateFormatter: Intl.DateTimeFormat;
  panelId: string;
  onSelectCommit?: (commit: ProjectGitCommit) => void;
  query: GitHistoryQueryState;
}>;

function GitCommitSummary({
  commit,
  compact,
  dateFormatter,
}: Readonly<{
  commit: ProjectGitCommit;
  compact: boolean;
  dateFormatter: Intl.DateTimeFormat;
}>) {
  const formattedDate = dateFormatter.format(new Date(commit.authoredAt));
  return (
    <span className="min-w-0">
      <span
        className={cn(
          "block truncate font-medium text-foreground",
          compact ? "text-label" : "text-body-small",
        )}
        title={commit.title}
      >
        {commit.title}
      </span>
      <span
        className={cn(
          "flex min-w-0 items-center gap-1.5 text-muted-foreground",
          compact ? "text-meta" : "mt-0.5 text-caption",
        )}
      >
        <code className="shrink-0">{commit.sha.slice(0, compact ? 7 : 12)}</code>
        <span aria-hidden="true">·</span>
        <span className="truncate" title={commit.authorEmail}>
          {commit.authorName}
        </span>
        <span aria-hidden="true">·</span>
        <time
          className={cn(compact ? "min-w-0 truncate" : "shrink-0")}
          dateTime={commit.authoredAt}
          title={formattedDate}
        >
          {formattedDate}
        </time>
      </span>
    </span>
  );
}

type GitCommitCopyField = "author" | "hash" | "message";

export function getGitCommitCopyText(commit: ProjectGitCommit, field: GitCommitCopyField): string {
  const values: Record<GitCommitCopyField, string> = {
    author: commit.authorName,
    hash: commit.sha,
    message: commit.title,
  };
  return values[field];
}

export function copyGitCommitText(commit: ProjectGitCommit, field: GitCommitCopyField): void {
  // 菜单选中后立即关闭，剪贴板失败不影响历史列表的当前状态。
  void navigator.clipboard.writeText(getGitCommitCopyText(commit, field)).catch(() => undefined);
}

export function GitCommitContextMenuItems({ commit }: Readonly<{ commit: ProjectGitCommit }>) {
  useTranslation("conversation");
  const items = [
    ["message", i18n.t("gitHistory.copyMessage", { ns: "conversation" })],
    ["author", i18n.t("gitHistory.copyAuthor", { ns: "conversation" })],
    ["hash", i18n.t("gitHistory.copyHash", { ns: "conversation" })],
  ] as const satisfies readonly (readonly [GitCommitCopyField, string])[];

  return (
    <ContextMenuContent aria-label={i18n.t("gitHistory.copyMenuLabel", { ns: "conversation" })}>
      {items.map(([field, label]) => (
        <ContextMenuItem
          key={field}
          onSelect={() => {
            copyGitCommitText(commit, field);
          }}
        >
          <Copy aria-hidden="true" className="size-3.5" />
          {label}
        </ContextMenuItem>
      ))}
    </ContextMenuContent>
  );
}

function GitCommitListItem({
  commit,
  compact,
  dateFormatter,
  isLast,
  onSelectCommit,
}: Readonly<{
  commit: ProjectGitCommit;
  compact: boolean;
  dateFormatter: Intl.DateTimeFormat;
  isLast: boolean;
  onSelectCommit?: (commit: ProjectGitCommit) => void;
}>) {
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <li
          className={cn(
            "relative grid min-w-0 grid-cols-[auto_minmax(0,1fr)]",
            compact ? "gap-x-1.5 px-3 py-1.5" : "gap-x-2.5 px-4 py-2.5",
          )}
        >
          <div className="relative flex w-4 justify-center" aria-hidden="true">
            {!isLast ? (
              <span className="absolute bottom-[-0.625rem] top-3 w-px bg-separator-strong" />
            ) : null}
            <GitCommitHorizontal className="relative mt-0.5 size-3.5 text-brand" />
          </div>
          {onSelectCommit === undefined ? (
            <div className="min-w-0">
              <GitCommitSummary commit={commit} compact={compact} dateFormatter={dateFormatter} />
            </div>
          ) : (
            <Button
              className="h-auto min-w-0 justify-start rounded-none p-0 text-left"
              contentAlign="start"
              onClick={() => {
                onSelectCommit(commit);
              }}
              type="button"
              variant="ghost"
            >
              <GitCommitSummary commit={commit} compact={compact} dateFormatter={dateFormatter} />
            </Button>
          )}
        </li>
      </ContextMenuTrigger>
      <GitCommitContextMenuItems commit={commit} />
    </ContextMenu>
  );
}

export function GitHistoryContent({
  active,
  className,
  compact = false,
  dateFormatter,
  panelId,
  onSelectCommit,
  query,
}: GitHistoryContentProps) {
  const commits = useMemo(
    () => query.data?.pages.flatMap((page) => page.commits) ?? [],
    [query.data?.pages],
  );

  return (
    <div
      aria-label={i18n.t("gitHistory.commits", { ns: "conversation" })}
      className={cn("h-full min-h-0 overflow-y-auto", !active && "hidden", className)}
      data-slot="git-history-content"
      hidden={!active}
      id={panelId}
      role="tabpanel"
    >
      {query.isPending ? (
        <p className="px-5 py-12 text-center text-body-small text-muted-foreground">
          {i18n.t("gitHistory.loading", { ns: "conversation" })}
        </p>
      ) : query.error !== null ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-5 text-center">
          <p className="text-body-small text-danger">
            {i18n.t("gitHistory.loadError", { ns: "conversation" })}
          </p>
          <Button onClick={() => void query.refetch()} type="button" variant="outline">
            {i18n.t("gitHistory.retry", { ns: "conversation" })}
          </Button>
        </div>
      ) : commits.length === 0 ? (
        <p className="px-5 py-12 text-center text-body-small text-muted-foreground">
          {i18n.t("gitHistory.empty", { ns: "conversation" })}
        </p>
      ) : (
        <>
          <ol aria-label={i18n.t("gitHistory.commits", { ns: "conversation" })}>
            {commits.map((commit, index) => (
              <GitCommitListItem
                commit={commit}
                compact={compact}
                dateFormatter={dateFormatter}
                isLast={index === commits.length - 1}
                key={commit.sha}
                {...(onSelectCommit === undefined ? {} : { onSelectCommit })}
              />
            ))}
          </ol>
          <div
            className={cn(
              "flex items-center justify-center",
              compact ? "min-h-8 px-3 py-1" : "min-h-12 px-4 py-3",
            )}
          >
            {query.hasNextPage ? (
              <Button
                className={compact ? "w-full" : "max-workbench:h-11"}
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
                size={compact ? "sm" : "default"}
                type="button"
                variant="outline"
              >
                {query.isFetchingNextPage ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                ) : null}
                {query.isFetchingNextPage
                  ? i18n.t("gitHistory.loadingMore", { ns: "conversation" })
                  : i18n.t("gitHistory.loadMore", { ns: "conversation" })}
              </Button>
            ) : (
              <p className="text-caption text-muted-foreground" role="status">
                {i18n.t("gitHistory.end", { ns: "conversation" })}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

type GitHistoryListProps = Readonly<{
  active?: boolean;
  client: CodexlyGitHistoryClient;
  compact?: boolean;
  dateFormatter: Intl.DateTimeFormat;
  enabled?: boolean;
  onBranchLoaded?: (repository: string, branch: string | null) => void;
  onSelectCommit?: (commit: ProjectGitCommit) => void;
  panelId: string;
  projectId: string;
  repository?: string;
  rootPath: string;
  showBranch?: boolean;
}>;

export function GitHistoryList({
  active = true,
  client,
  compact = false,
  dateFormatter,
  enabled = true,
  onBranchLoaded,
  onSelectCommit,
  panelId,
  projectId,
  repository,
  rootPath,
  showBranch = false,
}: GitHistoryListProps) {
  useTranslation("conversation");
  const query = useInfiniteQuery(
    projectGitHistoryInfiniteQueryOptions(projectId, rootPath, repository, enabled, client),
  );
  const branch = query.data?.pages[0]?.branch;

  useEffect(() => {
    if (repository !== undefined && branch !== undefined) {
      onBranchLoaded?.(repository, branch);
    }
  }, [branch, onBranchLoaded, repository]);

  const content = (
    <GitHistoryContent
      active={active}
      compact={compact}
      dateFormatter={dateFormatter}
      panelId={panelId}
      {...(onSelectCommit === undefined ? {} : { onSelectCommit })}
      query={query}
    />
  );

  if (!showBranch) {
    return content;
  }

  const displayBranch = branch === undefined ? null : (branch ?? "detached HEAD");
  return (
    <div className={cn("flex h-full min-h-0 flex-col", !active && "hidden")} hidden={!active}>
      <div className="shrink-0 px-4 py-2">
        <p
          className="truncate text-caption text-muted-foreground"
          title={displayBranch ?? undefined}
        >
          {displayBranch === null
            ? i18n.t("gitHistory.branchLoading", { ns: "conversation" })
            : i18n.t("gitHistory.branch", { branch: displayBranch, ns: "conversation" })}
        </p>
      </div>
      <div className="min-h-0 flex-1">{content}</div>
    </div>
  );
}
