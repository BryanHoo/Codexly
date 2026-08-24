import { GitCommitHorizontal, GitCompareArrows } from "lucide-react";

import { i18n } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { InspectorSection } from "./workbench-inspector-sections.js";

export function InspectorGitChangesSection({
  changeCount,
  changeStats,
  onCommitChanges,
}: Readonly<{
  changeCount: number;
  changeStats: Readonly<{ additions: number; removals: number }> | undefined;
  onCommitChanges: () => void;
}>) {
  if (changeCount === 0) return null;

  return (
    <InspectorSection
      action={
        <Button
          aria-label={i18n.t("inspector.commitChanges", {
            count: changeCount,
            ns: "conversation",
          })}
          className="h-6 gap-1 px-1.5 text-caption font-medium"
          id="workbench-commit-changes"
          onClick={onCommitChanges}
          size="toolbar"
          type="button"
          variant="ghost"
        >
          <GitCommitHorizontal aria-hidden="true" className="size-3.5" />
          {i18n.t("inspector.commit", { ns: "conversation" })}
        </Button>
      }
      icon={<GitCompareArrows className="size-3.5" />}
      title={i18n.t("inspector.gitChanges", { ns: "conversation" })}
    >
      <div
        aria-label={i18n.t("inspector.changeStats", { ns: "conversation" })}
        className="flex min-h-6 items-center gap-1.5 px-2 text-caption text-muted-foreground"
      >
        <span>
          {i18n.t("inspector.gitChangesCount", {
            count: changeCount,
            ns: "conversation",
          })}
        </span>
        {changeStats === undefined ? null : (
          <>
            <span className="font-medium text-diff-added">+{changeStats.additions}</span>
            <span className="font-medium text-diff-removed">-{changeStats.removals}</span>
          </>
        )}
      </div>
    </InspectorSection>
  );
}
