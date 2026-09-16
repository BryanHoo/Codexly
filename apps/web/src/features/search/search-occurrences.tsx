import type { AgentTask, SearchOccurrence } from "@codexly/protocol";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  History,
  LoaderCircle,
} from "lucide-react";
import type { RefObject, UIEvent } from "react";

import { useTranslation } from "../../i18n/i18n.js";
import { Button } from "../../shared/components/core/button.js";
import { SearchHighlight } from "./search-highlight.js";
import type { useSearchOccurrences } from "./use-search-occurrences.js";

export function SearchOccurrences({
  listRef,
  onBack,
  onOpenTask,
  onScroll,
  onSelect,
  query,
  search,
  task,
}: Readonly<{
  listRef: RefObject<HTMLDivElement | null>;
  onBack: () => void;
  onOpenTask: () => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  onSelect: (occurrence: SearchOccurrence) => void;
  query: string;
  search: ReturnType<typeof useSearchOccurrences>;
  task: AgentTask;
}>) {
  const { t } = useTranslation("workbench");
  const { results } = search;
  return (
    <div
      className="max-h-[min(58vh,34rem)] min-h-72 overflow-auto p-3"
      onScroll={onScroll}
      ref={listRef}
    >
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-separator px-1 pb-3">
        <Button onClick={onBack} size="sm" variant="ghost">
          <ArrowLeft />
          {t("globalSearch.back")}
        </Button>
        <Button onClick={onOpenTask} size="sm" variant="ghost">
          {t("globalSearch.openTask")}
          <ExternalLink />
        </Button>
      </div>
      <div className="px-3 pb-2 pt-1">
        <h3 className="truncate text-body font-medium">{task.title}</h3>
        <p className="mt-1 text-caption text-muted-foreground">{t("globalSearch.occurrences")}</p>
      </div>
      {results.isPending ? (
        <p
          className="flex items-center justify-center gap-2 p-6 text-caption text-muted-foreground"
          role="status"
        >
          <LoaderCircle className="size-3.5 animate-spin" />
          {t("globalSearch.loading")}
        </p>
      ) : null}
      {results.isError ? (
        <div className="p-3" role="alert">
          {t("globalSearch.error")}{" "}
          <Button onClick={() => void results.refetch()} size="sm" variant="ghost">
            {t("globalSearch.retry")}
          </Button>
        </div>
      ) : null}
      {results.data?.data.length === 0 ? (
        <p className="p-3" role="status">
          {t("globalSearch.unavailable")}
        </p>
      ) : null}
      {results.data?.data.map((occurrence, index) => (
        <button
          className="group mb-1 flex w-full items-start gap-3 rounded-surface border border-transparent px-3 py-3 text-left text-body-small outline-none transition-[background-color,border-color] hover:border-separator hover:bg-control focus-visible:shadow-focus"
          key={`${occurrence.turnId}:${occurrence.itemId}:${String(index)}`}
          onClick={() => {
            onSelect(occurrence);
          }}
          type="button"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-control bg-control text-muted-foreground shadow-sm group-hover:bg-raised group-hover:text-brand">
            <History aria-hidden="true" className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1 leading-5 text-foreground">
            <SearchHighlight
              query={query}
              range={occurrence.snippetMatchRange}
              text={occurrence.snippet}
            />
          </span>
        </button>
      ))}
      <div className="mt-3 flex justify-between border-t border-separator pt-3">
        {search.hasPrevious ? (
          <Button onClick={search.previous} size="sm" variant="ghost">
            <ChevronLeft />
            {t("globalSearch.previous")}
          </Button>
        ) : (
          <span />
        )}
        {results.data?.nextCursor ? (
          <Button onClick={search.next} size="sm" variant="ghost">
            {t("globalSearch.next")}
            <ChevronRight />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
