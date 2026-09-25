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
      className="flex min-h-7 items-center justify-between gap-2 px-1"
    >
      <div className="flex min-w-0 items-center gap-2 whitespace-nowrap text-label">
        <p className="shrink-0 font-medium text-foreground/80">
          {i18n.t("inspector.gitChangesCount", {
            count: changeCount,
            ns: "conversation",
          })}
        </p>
        {/* 详情未就绪时不显示占位零值；文件数与真实统计保持单行对齐。 */}
        <p className="flex items-center gap-1 text-caption tabular-nums">
          {changeStats === undefined ? null : (
            <>
              <span className="font-medium text-diff-added">+{changeStats.additions}</span>
              <span className="font-medium text-diff-removed">-{changeStats.removals}</span>
            </>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          aria-haspopup="dialog"
          disabled={changeCount === 0}
          onClick={onReviewChanges}
          size="toolbar"
          type="button"
          className="bg-control/50 px-2 text-caption font-medium"
          variant="ghost"
        >
          {i18n.t("timeline.review", { ns: "conversation" })}
        </Button>
        <Button
          aria-label={i18n.t("inspector.commitChanges", {
            count: changeCount,
            ns: "conversation",
          })}
          id="workbench-commit-changes"
          onClick={onCommitChanges}
          size="toolbar"
          type="button"
          className="bg-control/50 px-2 text-caption font-medium"
          variant="ghost"
        >
          {i18n.t("inspector.commit", { ns: "conversation" })}
        </Button>
      </div>
    </section>
  );
}
