import type { ProjectGitCommit } from "@code-agent/protocol";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState, type KeyboardEvent } from "react";

import { i18n, useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { cn } from "../../../shared/lib/utils.js";
import {
  codeAgentClient,
  projectGitHistoryInfiniteQueryOptions,
  type CodeAgentGitCommitReviewClient,
  type CodeAgentGitHistoryClient,
} from "../../projects/project-queries.js";
import { GitCommitReview } from "./git-commit-review.js";
import { GitHistoryContent, GitHistoryList } from "./git-history-list.js";

type GitHistoryClient = CodeAgentGitHistoryClient & CodeAgentGitCommitReviewClient;

type QueriedGitHistoryPanelProps = Readonly<{
  active: boolean;
  client: GitHistoryClient;
  dateFormatter: Intl.DateTimeFormat;
  onBranchLoaded: (repository: string, branch: string | null) => void;
  onSelectCommit: (commit: ProjectGitCommit, repository: string) => void;
  panelId: string;
  projectId: string;
  repository: string;
  rootPath: string;
}>;

function QueriedGitHistoryPanel({
  active,
  client,
  dateFormatter,
  onBranchLoaded,
  onSelectCommit,
  panelId,
  projectId,
  repository,
  rootPath,
}: QueriedGitHistoryPanelProps) {
  return (
    <GitHistoryList
      active={active}
      client={client}
      dateFormatter={dateFormatter}
      onBranchLoaded={onBranchLoaded}
      onSelectCommit={(commit) => {
        onSelectCommit(commit, repository);
      }}
      panelId={panelId}
      projectId={projectId}
      repository={repository}
      rootPath={rootPath}
    />
  );
}

function getPanelId(index: number): string {
  return `git-history-panel-${String(index)}`;
}

export function GitHistoryPanel({
  client = codeAgentClient,
  projectId,
  rootPath,
}: Readonly<{ client?: GitHistoryClient; projectId: string; rootPath: string }>) {
  useTranslation("conversation");
  const [selectedRepository, setSelectedRepository] = useState<string>();
  const [visitedRepositories, setVisitedRepositories] = useState<readonly string[]>([]);
  const [repositoryBranches, setRepositoryBranches] = useState<ReadonlyMap<string, string | null>>(
    () => new Map(),
  );
  const [selectedCommit, setSelectedCommit] =
    useState<Readonly<{ commit: ProjectGitCommit; repository?: string }>>();
  const initialQuery = useInfiniteQuery(
    projectGitHistoryInfiniteQueryOptions(projectId, rootPath, undefined, true, client),
  );
  const initialPage = initialQuery.data?.pages[0];
  const initialRepository = initialPage?.repository ?? null;
  const activeRepository = selectedRepository ?? initialRepository;
  const repositories = initialPage?.repositories ?? [];
  const initialRepositoryIndex = Math.max(
    0,
    initialRepository === null ? 0 : repositories.indexOf(initialRepository),
  );
  const initialPanelId =
    repositories.length === 0 ? "git-history-panel" : getPanelId(initialRepositoryIndex);
  const activeBranch =
    selectedRepository === undefined
      ? initialPage?.branch
      : repositoryBranches.get(selectedRepository);
  const displayBranch = activeBranch === undefined ? null : (activeBranch ?? "detached HEAD");
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.resolvedLanguage === "en" ? "en" : "zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [],
  );

  const selectRepository = (repository: string) => {
    if (repository === initialRepository) {
      setSelectedRepository(undefined);
      return;
    }
    // 已访问仓库保持挂载，切回标签时保留分页结果和列表位置。
    setVisitedRepositories((current) =>
      current.includes(repository) ? current : [...current, repository],
    );
    setSelectedRepository(repository);
  };

  const rememberRepositoryBranch = useCallback((repository: string, branch: string | null) => {
    setRepositoryBranches((current) => {
      if (current.has(repository) && current.get(repository) === branch) {
        return current;
      }
      return new Map(current).set(repository, branch);
    });
  }, []);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (index + direction + repositories.length) % repositories.length;
    const nextRepository = repositories[nextIndex];
    if (nextRepository !== undefined) {
      selectRepository(nextRepository);
      document.querySelector<HTMLButtonElement>(`#git-history-tab-${String(nextIndex)}`)?.focus();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="git-history-panel">
      <div className="shrink-0 px-3 pb-2 pt-1">
        <p
          className="truncate text-caption text-muted-foreground"
          title={displayBranch ?? undefined}
        >
          {displayBranch === null
            ? i18n.t("gitHistory.branchLoading", { ns: "conversation" })
            : i18n.t("gitHistory.branch", { branch: displayBranch, ns: "conversation" })}
        </p>
      </div>

      {repositories.length === 0 ? null : (
        <div
          aria-label={i18n.t("gitHistory.repositories", { ns: "conversation" })}
          className="flex min-w-0 shrink-0 gap-1 overflow-x-auto border-b border-separator px-2.5 pb-2"
          role="tablist"
        >
          {repositories.map((repository, index) => {
            const active = repository === activeRepository;
            return (
              <Button
                aria-controls={getPanelId(index)}
                aria-selected={active}
                className={cn(
                  "h-7 shrink-0 rounded-control px-2 text-label max-workbench:h-11",
                  active
                    ? "bg-control text-foreground"
                    : "text-muted-foreground hover:bg-control-hover hover:text-foreground",
                )}
                id={`git-history-tab-${String(index)}`}
                key={repository}
                onClick={() => {
                  selectRepository(repository);
                }}
                onKeyDown={(event) => {
                  handleTabKeyDown(event, index);
                }}
                role="tab"
                tabIndex={active ? 0 : -1}
                type="button"
                variant="ghost"
              >
                {repository}
              </Button>
            );
          })}
        </div>
      )}

      <div className="min-h-0 flex-1" data-slot="git-history-panels">
        <GitHistoryContent
          active={selectedRepository === undefined}
          compact
          dateFormatter={dateFormatter}
          panelId={initialPanelId}
          onSelectCommit={(commit) => {
            setSelectedCommit({
              commit,
              ...(activeRepository === null ? {} : { repository: activeRepository }),
            });
          }}
          query={initialQuery}
        />
        {visitedRepositories.map((repository) => {
          const repositoryIndex = repositories.indexOf(repository);
          if (repositoryIndex < 0) {
            return null;
          }
          return (
            <QueriedGitHistoryPanel
              active={selectedRepository === repository}
              client={client}
              dateFormatter={dateFormatter}
              key={repository}
              onBranchLoaded={rememberRepositoryBranch}
              onSelectCommit={(commit, selectedRepository) => {
                setSelectedCommit({ commit, repository: selectedRepository });
              }}
              panelId={getPanelId(repositoryIndex)}
              projectId={projectId}
              repository={repository}
              rootPath={rootPath}
            />
          );
        })}
      </div>

      {selectedCommit === undefined ? null : (
        <GitCommitReview
          client={client}
          commit={selectedCommit.commit}
          onClose={() => {
            setSelectedCommit(undefined);
          }}
          projectId={projectId}
          rootPath={rootPath}
          {...(selectedCommit.repository === undefined
            ? {}
            : { repository: selectedCommit.repository })}
        />
      )}
    </div>
  );
}
