import type { RefObject, UIEvent } from "react";
import type { useSearchOccurrences } from "./use-search-occurrences.js";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  History,
  LoaderCircle,
} from "lucide-react";
import type { AgentTask } from "@/protocol/index.js";
import type { SearchOccurrence } from "@/protocol/global-search.js";
import { useTranslation } from "../../i18n/i18n.js";
import { Button } from "../../shared/components/core/button.js";
import { SearchHighlight } from "./search-highlight.js";

export function SearchOccurrences({
  search,
  listRef,
  onScroll,
  task,
  query,
  onBack,
  onSelect,
  onOpenTask,
}: Readonly<{
  search: ReturnType<typeof useSearchOccurrences>;
  listRef: RefObject<HTMLDivElement | null>;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  task: AgentTask;
  query: string;
  onBack: () => void;
  onSelect: (occurrence: SearchOccurrence) => void;
  onOpenTask: () => void;
}>) {
  const { t } = useTranslation("workbench");
  const { results } = search;
  return (
    <div ref={listRef} onScroll={onScroll} className="max-h-[min(58vh,34rem)] min-h-72 overflow-auto p-3">
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-separator px-1 pb-3">
        <Button onClick={onBack} variant="ghost" size="sm">
          <ArrowLeft />
          {t("globalSearch.back")}
        </Button>
        <Button onClick={onOpenTask} variant="ghost" size="sm">
          {t("globalSearch.openTask")}
          <ExternalLink />
        </Button>
      </div>
      <div className="px-3 pb-2 pt-1">
        <h3 className="truncate text-body font-medium">{task.title}</h3>
        <p className="mt-1 text-caption text-muted-foreground">
          {t("globalSearch.occurrences")}
        </p>
      </div>
      {results.isPending ? (
        <p
          role="status"
          className="flex items-center justify-center gap-2 p-6 text-caption text-muted-foreground"
        >
          <LoaderCircle className="size-3.5 animate-spin" />
          {t("globalSearch.loading")}
        </p>
      ) : null}
      {results.isError ? (
        <div role="alert" className="p-3">
          {t("globalSearch.error")}{" "}
          <Button
            onClick={() => void results.refetch()}
            variant="ghost"
            size="sm"
          >
            {t("globalSearch.retry")}
          </Button>
        </div>
      ) : null}
      {results.data?.data.length === 0 ? (
        <p role="status" className="p-3">
          {t("globalSearch.unavailable")}
        </p>
      ) : null}
      {results.data?.data.map((occurrence, index) => (
        <button
          key={`${occurrence.turnId}:${occurrence.itemId}:${index}`}
          type="button"
          onClick={() => onSelect(occurrence)}
          className="group mb-1 flex w-full items-start gap-3 rounded-surface border border-transparent px-3 py-3 text-left text-body-small outline-none transition-[background-color,border-color] hover:border-separator hover:bg-control focus-visible:shadow-focus"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-control bg-control text-muted-foreground shadow-sm group-hover:bg-raised group-hover:text-brand">
            <History aria-hidden="true" className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1 leading-5 text-foreground">
            <SearchHighlight
              text={occurrence.snippet}
              query={query}
              range={occurrence.snippetMatchRange}
            />
          </span>
        </button>
      ))}
      <div className="mt-3 flex justify-between border-t border-separator pt-3">
        {search.hasPrevious ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={search.previous}
          >
            <ChevronLeft />
            {t("globalSearch.previous")}
          </Button>
        ) : (
          <span />
        )}
        {results.data?.nextCursor ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={search.next}
          >
            {t("globalSearch.next")}
            <ChevronRight />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
