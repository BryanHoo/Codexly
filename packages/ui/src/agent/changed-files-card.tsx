import { ChevronDown, ChevronUp, Files } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "../core/button.js";

type ChangedFilesCardProps<T> = Readonly<{
  additions: number;
  changes: readonly T[];
  collapseLabel: string;
  label: string;
  moreLabel: (count: number) => string;
  onReview: () => void;
  removals: number;
  renderChange: (change: T) => ReactNode;
  reviewLabel: string;
  title: string;
}>;

// 两端共用密度、折叠与视觉层次；翻译、补丁统计和平台动作由调用端注入。
export function ChangedFilesCard<T>({
  additions,
  changes,
  collapseLabel,
  label,
  moreLabel,
  onReview,
  removals,
  renderChange,
  reviewLabel,
  title,
}: ChangedFilesCardProps<T>) {
  const [expanded, setExpanded] = useState(false);
  const visibleChanges = expanded ? changes : changes.slice(0, 3);

  return (
    <section aria-label={label} className="agent-changed-files-card">
      <header className="agent-changed-files-header">
        <Files aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <h3 className="min-w-0 truncate text-label font-semibold">{title}</h3>
        <span className="agent-changed-files-stats text-label">
          <span className="agent-changed-files-added" data-zero={additions === 0}>
            +{additions}
          </span>
          <span className="agent-changed-files-removed" data-zero={removals === 0}>
            -{removals}
          </span>
        </span>
        <Button
          aria-haspopup="dialog"
          className="agent-changed-files-review ml-auto"
          onClick={onReview}
          size="toolbar"
          type="button"
          variant="ghost"
        >
          {reviewLabel}
        </Button>
      </header>
      <div className="agent-changed-files-list">{visibleChanges.map(renderChange)}</div>
      {changes.length > 3 ? (
        <Button
          aria-expanded={expanded}
          className="agent-changed-files-toggle w-full"
          onClick={() => {
            setExpanded((value) => !value);
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          {expanded ? collapseLabel : moreLabel(changes.length - visibleChanges.length)}
          {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </Button>
      ) : null}
    </section>
  );
}
