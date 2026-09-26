import "./global-search.css";

import type { AgentTask, Project, SearchOccurrence } from "@codexly/protocol";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CircleX, LoaderCircle, Search, SearchX, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useTranslation } from "../../i18n/i18n.js";
import { Button } from "../../shared/components/core/button.js";
import { Checkbox } from "../../shared/components/core/checkbox.js";
import { Dialog, DialogContent, DialogTitle } from "../../shared/components/core/dialog.js";
import { Input } from "../../shared/components/core/input.js";
import { notifyActionError } from "../notifications/action-notifications.js";
import type { CodexlyWorkbenchClient } from "../projects/project-query-contracts.js";
import { useHistoryLocation } from "./history-location.js";
import { prepareSearchFile } from "./open-search-file.js";
import { SearchOccurrences } from "./search-occurrences.js";
import { SearchPagination } from "./search-pagination.js";
import { SearchResults, type SearchResult } from "./search-results.js";
import type { SearchFile } from "./search-files.js";
import { useGlobalSearch, type SearchCategory } from "./use-global-search.js";
import { useSearchOccurrences } from "./use-search-occurrences.js";
import { useSearchVisibility } from "./use-search-visibility.js";

export function GlobalSearchDialog({
  client,
  onClose,
  onOpenFile,
  open,
  projects,
}: Readonly<{
  client: CodexlyWorkbenchClient;
  onClose: () => void;
  onOpenFile: (file: SearchFile, kind: "image" | "source") => void;
  open: boolean;
  projects: readonly Project[];
}>) {
  const { t } = useTranslation("workbench");
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SearchCategory>("all");
  const [archived, setArchived] = useState(false);
  const [composing, setComposing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [taskCursors, setTaskCursors] = useState<(string | undefined)[]>([undefined]);
  const [historyCursors, setHistoryCursors] = useState<(string | undefined)[]>([undefined]);
  const [historyTask, setHistoryTask] = useState<AgentTask | null>(null);
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const actionAbortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const visibility = useSearchVisibility(open, inputRef, listRef, actionAbortRef);
  const normalized = query.trim();
  const occurrences = useSearchOccurrences(client, historyTask, normalized, open);
  const results = useGlobalSearch(
    client,
    projects,
    historyTask === null ? normalized : "",
    category,
    archived,
    composing,
    taskCursors.at(-1),
    historyCursors.at(-1),
    open,
  );
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const rows: SearchResult[] = [];
  for (const kind of ["tasks", "history"] as const) {
    if (category !== "all" && category !== kind) continue;
    for (const result of results[kind].data?.data ?? []) {
      rows.push({
        id: `${kind}:${result.task.id}`,
        kind,
        ...(result.occurrence === undefined ? {} : { occurrence: result.occurrence }),
        snippet: result.snippet,
        subtitle: projectNames.get(result.task.projectId) ?? t("globalSearch.temporary"),
        task: result.task,
        title: result.task.title,
      });
    }
  }
  if (category === "all" || category === "files") {
    for (const file of results.files.data?.files ?? []) {
      rows.push({
        file,
        id: `file:${file.projectId}:${file.rootPath}:${file.path}`,
        kind: "files",
        snippet: "",
        subtitle: `${file.projectName} · ${file.path}`,
        title: file.name,
      });
    }
  }
  const selectedIndex = Math.max(
    0,
    rows.findIndex((row) => row.id === selectedId),
  );
  const selected = rows[selectedIndex];
  const visibleQueries =
    category === "all" ? [results.tasks, results.history, results.files] : [results[category]];
  const loading =
    normalized.length > 0 &&
    (results.waiting || visibleQueries.some((result) => result.isFetching));
  const failed = visibleQueries.some((result) => result.isError);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected?.id]);

  const openTask = async (task: AgentTask, occurrence?: SearchOccurrence) => {
    useHistoryLocation
      .getState()
      .setLocation(
        occurrence === undefined
          ? null
          : { ...occurrence, projectId: task.projectId, query: normalized, taskId: task.id },
      );
    await (task.projectId === "temporary"
      ? navigate({ params: { taskId: task.id }, to: "/temporary/t/$taskId" })
      : navigate({
          params: { projectId: task.projectId, taskId: task.id },
          to: "/p/$projectId/t/$taskId",
        }));
    onClose();
  };
  const activate = async (row: SearchResult) => {
    if (openingRef.current) return;
    openingRef.current = true;
    const controller = new AbortController();
    actionAbortRef.current = controller;
    setOpening(true);
    try {
      if (row.kind === "history" && row.task !== undefined) {
        if (row.occurrence === undefined) setHistoryTask(row.task);
        else await openTask(row.task, row.occurrence);
      } else if (row.file !== undefined) {
        const kind = await prepareSearchFile(client, cache, row.file, controller.signal);
        if (kind !== null) {
          onOpenFile(row.file, kind);
          onClose();
        }
      } else if (row.task !== undefined) await openTask(row.task);
    } catch (error) {
      if (!controller.signal.aborted) {
        notifyActionError(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  };
  const resetPages = () => {
    visibility.resetScroll();
    actionAbortRef.current?.abort();
    setSelectedId(null);
    setTaskCursors([undefined]);
    setHistoryCursors([undefined]);
    setHistoryTask(null);
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) onClose();
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className="top-[12%] max-w-[46rem] -translate-y-0 gap-0 overflow-hidden border border-separator-strong p-0 shadow-floating"
          onCloseAutoFocus={visibility.onCloseAutoFocus}
          onOpenAutoFocus={visibility.onOpenAutoFocus}
        >
          <DialogTitle className="sr-only">{t("globalSearch.title")}</DialogTitle>
          <div className="flex items-center gap-2 border-b border-separator px-4 pb-3 pt-4">
            <div className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-surface border border-separator-strong bg-control px-3 transition-[background-color,border-color,box-shadow] focus-within:border-brand focus-within:bg-panel focus-within:shadow-focus">
              <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <Input
                aria-activedescendant={
                  historyTask === null && selected !== undefined
                    ? `global-search-option-${String(selectedIndex)}`
                    : undefined
                }
                aria-autocomplete="list"
                aria-controls="global-search-results"
                aria-expanded={historyTask === null}
                aria-label={t("globalSearch.title")}
                autoComplete="off"
                className="h-full rounded-control appearance-none border-0 bg-transparent p-0 text-body focus-visible:shadow-none"
                data-global-search-input
                maxLength={1024}
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                  resetPages();
                }}
                onCompositionEnd={() => {
                  setComposing(false);
                }}
                onCompositionStart={() => {
                  setComposing(true);
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || composing) return;
                  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
                    event.preventDefault();
                    event.currentTarget.select();
                    return;
                  }
                  if (historyTask !== null || rows.length === 0) return;
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const offset = event.key === "ArrowDown" ? 1 : rows.length - 1;
                    const nextRow = rows[(selectedIndex + offset) % rows.length];
                    if (nextRow !== undefined) setSelectedId(nextRow.id);
                  } else if (event.key === "Enter" && selected !== undefined) {
                    event.preventDefault();
                    void activate(selected);
                  }
                }}
                placeholder={t("globalSearch.placeholder")}
                ref={inputRef}
                role="combobox"
                spellCheck={false}
                value={query}
                variant="embedded"
              />
              {query.length > 0 ? (
                <Button
                  aria-label={t("globalSearch.clear")}
                  className="text-muted-foreground"
                  onClick={() => {
                    setQuery("");
                    resetPages();
                    inputRef.current?.focus();
                  }}
                  size="icon-sm"
                  variant="ghost"
                >
                  <CircleX className="size-3.5" />
                </Button>
              ) : null}
            </div>
            <Button
              aria-label={t("globalSearch.close")}
              className="size-10"
              onClick={onClose}
              size="icon-compact"
              variant="ghost"
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="flex items-center gap-3 border-b border-separator px-4 py-2.5">
            <div
              aria-label={t("globalSearch.categories")}
              className="grid grid-cols-4 rounded-control bg-control p-0.5"
              role="group"
            >
              {(["all", "tasks", "history", "files"] as const).map((kind) => (
                <Button
                  aria-pressed={category === kind}
                  className={`h-7 px-3 ${category === kind ? "bg-raised text-foreground shadow-control" : "text-muted-foreground"}`}
                  key={kind}
                  onClick={() => {
                    setCategory(kind);
                    resetPages();
                  }}
                  size="sm"
                  variant="ghost"
                >
                  {t(`globalSearch.${kind}`)}
                </Button>
              ))}
            </div>
            <label className="ml-auto flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-caption text-muted-foreground transition-colors hover:bg-control hover:text-foreground">
              <Checkbox
                checked={archived}
                onCheckedChange={(checked) => {
                  setArchived(checked === true);
                  resetPages();
                }}
              />
              {t("globalSearch.archived")}
            </label>
          </div>
          {historyTask !== null ? (
            <SearchOccurrences
              listRef={listRef}
              onBack={() => {
                setHistoryTask(null);
              }}
              onOpenTask={() => {
                void openTask(historyTask);
              }}
              onScroll={visibility.onScroll}
              onSelect={(occurrence) => {
                void openTask(historyTask, occurrence);
              }}
              query={normalized}
              search={occurrences}
              task={historyTask}
            />
          ) : (
            <div
              className="max-h-[min(58vh,34rem)] min-h-72 overflow-y-auto p-2"
              onScroll={visibility.onScroll}
              ref={listRef}
            >
              {normalized.length === 0 ? (
                <div className="grid min-h-64 place-items-center px-6 text-center text-muted-foreground">
                  <div>
                    <Search className="mx-auto mb-3 size-6 opacity-60" />
                    <p className="text-body-small">{t("globalSearch.hint")}</p>
                  </div>
                </div>
              ) : null}
              <SearchResults
                busy={loading || opening}
                onActivate={(row) => {
                  void activate(row);
                }}
                onSelect={setSelectedId}
                query={normalized}
                rows={rows}
                selectedId={selected?.id}
              />
              {loading ? (
                <p
                  className="flex items-center justify-center gap-2 p-5 text-caption text-muted-foreground"
                  role="status"
                >
                  <LoaderCircle className="size-3.5 animate-spin" />
                  {t("globalSearch.loading")}
                </p>
              ) : null}
              {failed ? (
                <div className="p-3 text-caption text-danger" role="alert">
                  {t("globalSearch.error")}{" "}
                  <Button
                    onClick={() => {
                      for (const result of visibleQueries) {
                        if (result.isError) void result.refetch();
                      }
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    {t("globalSearch.retry")}
                  </Button>
                </div>
              ) : null}
              {!loading && !failed && normalized && rows.length === 0 ? (
                <div
                  className="grid min-h-56 place-items-center px-6 text-center text-muted-foreground"
                  role="status"
                >
                  <div>
                    <SearchX className="mx-auto mb-3 size-6 opacity-60" />
                    <p className="text-body-small">{t("globalSearch.empty")}</p>
                  </div>
                </div>
              ) : null}
              {results.files.data?.failedRoots.length ? (
                <p
                  className="p-3 text-caption text-warning"
                  role="alert"
                  title={results.files.data.failedRoots.join("\n")}
                >
                  {t("globalSearch.partial")}
                </p>
              ) : null}
              {results.files.data?.truncated ? (
                <p className="p-3 text-caption text-muted-foreground">
                  {t("globalSearch.fileLimit")}
                </p>
              ) : null}
              {category === "all" || category === "tasks" ? (
                <SearchPagination
                  cursors={taskCursors}
                  kind="tasks"
                  nextCursor={results.tasks.data?.nextCursor}
                  setCursors={setTaskCursors}
                />
              ) : null}
              {category === "all" || category === "history" ? (
                <SearchPagination
                  cursors={historyCursors}
                  kind="history"
                  nextCursor={results.history.data?.nextCursor}
                  setCursors={setHistoryCursors}
                />
              ) : null}
            </div>
          )}
          {historyTask === null ? (
            <div className="flex min-h-11 items-center justify-between border-t border-separator bg-control/40 px-4 py-2 text-caption text-muted-foreground">
              <p>{t("globalSearch.resultCount", { count: rows.length })}</p>
              <span className="ml-auto mr-3">{t("globalSearch.keyboard")}</span>
              {selected?.kind === "history" && selected.task !== undefined ? (
                <Button
                  onClick={() => {
                    if (selected.task !== undefined) setHistoryTask(selected.task);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  {t("globalSearch.occurrences")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
