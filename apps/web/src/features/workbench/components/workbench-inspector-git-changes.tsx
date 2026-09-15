import { i18n } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";

export function InspectorGitChangesSection({
  changeCount,
  changeStats,
  onCommitChanges,
  onReviewChanges,
}: Readonly<{
  changeCount: number;
  changeStats: Readonly<{ additions: number; removals: number }> | undefined;
  onCommitChanges: () => void;
  onReviewChanges: () => void;
}>) {
  if (changeCount === 0) return null;

  return (
    <section
      aria-label={i18n.t("inspector.gitChanges", { ns: "conversation" })}
      className="flex h-8 items-center justify-between gap-2"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="block text-xs font-medium text-foreground" data-git-change-count="">
          {i18n.t("inspector.gitChangedFilesCount", {
            count: changeCount,
            ns: "conversation",
          })}
        </span>
        {changeStats === undefined ? null : (
          <div className="flex items-center gap-1.5 text-caption" data-git-change-stats="">
            <span className="font-medium text-diff-added">+{changeStats.additions}</span>
            <span className="font-medium text-diff-removed">-{changeStats.removals}</span>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          aria-label={i18n.t("inspector.reviewChanges", {
            count: changeCount,
            ns: "conversation",
          })}
          className="h-6 px-1.5 text-caption font-medium"
          onClick={onReviewChanges}
          size="toolbar"
          type="button"
          variant="secondary"
        >
          {i18n.t("timeline.review", { ns: "conversation" })}
        </Button>
        <Button
          aria-label={i18n.t("inspector.commitChanges", {
            count: changeCount,
            ns: "conversation",
          })}
          className="h-6 px-1.5 text-caption font-medium"
          id="workbench-commit-changes"
          onClick={onCommitChanges}
          size="toolbar"
          type="button"
          variant="secondary"
        >
          {i18n.t("inspector.commit", { ns: "conversation" })}
        </Button>
      </div>
    </section>
  );
}
