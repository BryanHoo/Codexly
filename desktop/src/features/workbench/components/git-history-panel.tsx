import type { ProjectGitCommit } from "@/protocol/index.js";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { i18n, useTranslation } from "../../../i18n/i18n.js";
import {
  nativeClient,
  projectGitHistoryInfiniteQueryOptions,
  type NativeGitCommitReviewClient,
  type NativeGitHistoryClient,
} from "../../projects/project-queries.js";
import { GitHistoryContent } from "./git-history-list.js";

type GitHistoryClient = NativeGitHistoryClient & NativeGitCommitReviewClient;

export function GitHistoryPanel({
  client = nativeClient,
  onOpenCommit = () => undefined,
  projectId,
  rootPath,
}: Readonly<{
  client?: GitHistoryClient;
  onOpenCommit?: (commit: ProjectGitCommit, repository?: string) => void;
  projectId: string;
  rootPath: string;
}>) {
  useTranslation("conversation");
  // 历史仅属于当前项目根仓库，不维护子仓库标签或额外查询。
  const query = useInfiniteQuery(
    projectGitHistoryInfiniteQueryOptions(projectId, rootPath, undefined, true, client),
  );
  const branch = query.data?.pages[0]?.branch;
  const displayBranch = branch === undefined ? null : (branch ?? "detached HEAD");
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.resolvedLanguage === "en" ? "en" : "zh-CN", {
      dateStyle: "medium",
      timeStyle: "short",
    }),
    [],
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="git-history-panel">
      <div className="shrink-0 px-3 pb-2 pt-1">
        <p className="truncate text-caption text-muted-foreground" title={displayBranch ?? undefined}>
          {displayBranch === null
            ? i18n.t("gitHistory.branchLoading", { ns: "conversation" })
            : i18n.t("gitHistory.branch", { branch: displayBranch, ns: "conversation" })}
        </p>
      </div>
      <div className="min-h-0 flex-1" data-slot="git-history-panels">
        <GitHistoryContent
          active
          compact
          dateFormatter={dateFormatter}
          panelId="git-history-panel"
          onSelectCommit={(commit) => { onOpenCommit(commit); }}
          query={query}
        />
      </div>
    </div>
  );
}
