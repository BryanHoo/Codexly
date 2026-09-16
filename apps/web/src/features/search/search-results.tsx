import type { AgentTask, SearchOccurrence } from "@codexly/protocol";
import { CornerDownLeft, File, History, MessageSquare } from "lucide-react";

import { useTranslation } from "../../i18n/i18n.js";
import { SearchHighlight } from "./search-highlight.js";
import type { SearchFile } from "./search-files.js";

export type SearchResult = Readonly<{
  file?: SearchFile;
  id: string;
  kind: "tasks" | "history" | "files";
  occurrence?: SearchOccurrence;
  snippet: string;
  subtitle: string;
  task?: AgentTask;
  title: string;
}>;

export function SearchResults({
  busy,
  onActivate,
  onSelect,
  query,
  rows,
  selectedId,
}: Readonly<{
  busy: boolean;
  onActivate: (row: SearchResult) => void;
  onSelect: (id: string) => void;
  query: string;
  rows: readonly SearchResult[];
  selectedId: string | undefined;
}>) {
  const { t } = useTranslation("workbench");
  return (
    <div
      aria-busy={busy}
      aria-label={t("globalSearch.title")}
      id="global-search-results"
      role="listbox"
    >
      {(["tasks", "history", "files"] as const).map((kind) => {
        const group = rows.filter((row) => row.kind === kind);
        if (group.length === 0) return null;
        return (
          <div aria-label={t(`globalSearch.${kind}`)} className="pb-1" key={kind} role="group">
            <p className="flex items-center gap-2 px-3 pb-1.5 pt-3 text-caption font-medium text-muted-foreground">
              <span>{t(`globalSearch.${kind}`)}</span>
              <span className="rounded-pill bg-control px-1.5 py-0.5 tabular-nums">
                {group.length}
              </span>
            </p>
            {group.map((row) => {
              const index = rows.indexOf(row);
              const Icon = kind === "files" ? File : kind === "history" ? History : MessageSquare;
              return (
                <button
                  aria-selected={selectedId === row.id}
                  className="group flex w-full cursor-pointer items-start gap-3 rounded-surface border border-transparent px-3 py-2.5 text-left text-body-small outline-none transition-[background-color,border-color] hover:bg-control focus-visible:shadow-focus aria-selected:border-separator-strong aria-selected:bg-control"
                  id={`global-search-option-${String(index)}`}
                  key={row.id}
                  onClick={() => {
                    onActivate(row);
                  }}
                  onMouseEnter={() => {
                    onSelect(row.id);
                  }}
                  role="option"
                  tabIndex={-1}
                  type="button"
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-control bg-control text-muted-foreground shadow-sm transition-colors group-aria-selected:bg-raised group-aria-selected:text-brand">
                    <Icon aria-hidden="true" className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground">
                      <SearchHighlight query={query} text={row.title} />
                    </span>
                    <span className="block truncate text-caption text-muted-foreground">
                      {row.subtitle}
                    </span>
                    {row.snippet ? (
                      <span className="mt-1 line-clamp-2 block text-muted-foreground">
                        <SearchHighlight query={query} text={row.snippet} />
                      </span>
                    ) : null}
                  </span>
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
