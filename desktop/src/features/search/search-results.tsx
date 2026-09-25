import { CornerDownLeft, File, History, MessageSquare } from "lucide-react";
import type { SearchOccurrence } from "@/protocol/global-search.js";
import type { AgentTask } from "@/protocol/index.js";
import { useTranslation } from "../../i18n/i18n.js";
import { SearchHighlight } from "./search-highlight.js";
import type { SearchFile } from "./search-files.js";

export type SearchResult = Readonly<{
  id: string;
  kind: "tasks" | "history" | "files";
  title: string;
  subtitle: string;
  snippet: string;
  task?: AgentTask;
  occurrence?: SearchOccurrence;
  file?: SearchFile;
}>;

export function SearchResults({
  rows,
  query,
  selectedId,
  busy,
  onActivate,
  onSelect,
}: Readonly<{
  rows: readonly SearchResult[];
  query: string;
  selectedId: string | undefined;
  busy: boolean;
  onActivate: (row: SearchResult) => void;
  onSelect: (id: string) => void;
}>) {
  const { t } = useTranslation("workbench");
  return (
    <div
      id="global-search-results"
      role="listbox"
      aria-label={t("globalSearch.title")}
      aria-busy={busy}
    >
      {(["tasks", "history", "files"] as const).map((kind) => {
        const group = rows.filter((row) => row.kind === kind);
        if (group.length === 0) return null;
        return (
          <div
            className="pb-1"
            key={kind}
            role="group"
            aria-label={t(`globalSearch.${kind}`)}
          >
            <p className="flex items-center gap-2 px-3 pb-1.5 pt-3 text-caption font-medium text-muted-foreground">
              <span>{t(`globalSearch.${kind}`)}</span>
              <span className="rounded-pill bg-control px-1.5 py-0.5 tabular-nums">
                {group.length}
              </span>
            </p>
            {group.map((row) => {
              const index = rows.indexOf(row);
              const Icon =
                kind === "files"
                  ? File
                  : kind === "history"
                    ? History
                    : MessageSquare;
              return (
                <button
                  key={row.id}
                  id={`global-search-option-${index}`}
                  role="option"
                  type="button"
                  tabIndex={-1}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") onActivate(row);
                  }}
                  aria-selected={selectedId === row.id}
                  onClick={() => onActivate(row)}
                  onMouseEnter={() => onSelect(row.id)}
                  className="group flex w-full cursor-pointer items-start gap-3 rounded-surface border border-transparent px-3 py-2.5 text-left text-body-small outline-none transition-[background-color,border-color] hover:bg-control focus-visible:shadow-focus aria-selected:border-separator-strong aria-selected:bg-control"
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-control bg-control text-muted-foreground shadow-sm transition-colors group-aria-selected:bg-raised group-aria-selected:text-brand">
                    <Icon aria-hidden="true" className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">
                      <SearchHighlight text={row.title} query={query} />
                    </p>
                    <p className="truncate text-caption text-muted-foreground">
                      {row.subtitle}
                    </p>
                    {row.snippet ? (
                      <p className="mt-1 line-clamp-2 text-muted-foreground">
                        <SearchHighlight text={row.snippet} query={query} />
                      </p>
                    ) : null}
                  </div>
                  <CornerDownLeft
                    aria-hidden="true"
                    className="mt-1 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-aria-selected:opacity-100"
                  />
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
