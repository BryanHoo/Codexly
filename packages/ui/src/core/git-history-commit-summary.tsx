import type { ProjectGitCommit } from "@codexly/frontend-core/git-workspace-contract";
import { cn } from "../lib/utils.js";

export function GitCommitSummary({
  commit,
  compact,
  dateFormatter,
  unpushedLabel,
}: Readonly<{
  commit: ProjectGitCommit;
  compact: boolean;
  dateFormatter: Intl.DateTimeFormat;
  unpushedLabel: string;
}>) {
  const formattedDate = dateFormatter.format(new Date(commit.authoredAt));
  return (
    <span className="block w-full min-w-0">
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-medium text-foreground",
            compact ? "text-label" : "text-body-small",
          )}
          title={commit.title}
        >
          {commit.title}
        </span>
        {commit.unpushed === true ? (
          <span
            className="shrink-0 rounded-sm bg-brand/10 px-1.5 py-0.5 text-meta font-medium text-brand"
            data-slot="git-unpushed-badge"
          >
            {unpushedLabel}
          </span>
        ) : null}
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
