import "./global-search.css";
import { useSearchOccurrences } from "./use-search-occurrences.js";
import { useSearchVisibility } from "./use-search-visibility.js";
import "../../i18n/global-search.js";
import { SearchResults, type SearchResult } from "./search-results.js";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  CircleX,
  LoaderCircle,
  Search,
  SearchX,
  X,
} from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { AgentTask, Project } from "@/protocol/index.js";
import type { SearchOccurrence } from "@/protocol/global-search.js";
import type { NativeWorkbenchClient } from "../projects/project-query-contracts.js";
import { useTranslation } from "../../i18n/i18n.js";
import { Button } from "../../shared/components/core/button.js";
import { Checkbox } from "../../shared/components/core/checkbox.js";
import { Input } from "../../shared/components/core/input.js";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "../../shared/components/core/dialog.js";
import { prepareSearchFile } from "./open-search-file.js";
import { notifyActionError } from "../notifications/action-notifications.js";
import { useGlobalSearch, type SearchCategory } from "./use-global-search.js";
import { useHistoryLocation } from "./history-location.js";
import { SearchOccurrences } from "./search-occurrences.js";
import type { SearchFile } from "./search-files.js";

const ProjectSourceDialog = lazy(() =>
  import("../workbench/components/project-source-dialog.js").then((module) => ({
    default: module.ProjectSourceDialog,
  })),
);

export function GlobalSearchDialog({
  open,
  client,
  projects,
  onClose,
}: Readonly<{
  open: boolean;
  client: NativeWorkbenchClient;
  projects: readonly Project[];
  onClose: () => void;
}>) {
  const { t } = useTranslation("workbench");
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SearchCategory>("all");
  const [archived, setArchived] = useState(false);
  const [composing, setComposing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [taskCursors, setTaskCursors] = useState<(string | undefined)[]>([
    undefined,
  ]);
  const [historyCursors, setHistoryCursors] = useState<(string | undefined)[]>([
    undefined,
  ]);
  const [historyTask, setHistoryTask] = useState<AgentTask | null>(null);
  const [preview, setPreview] = useState<{
    file: SearchFile;
    kind: "image" | "source";
  } | null>(null);
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
  const projectNames = new Map(
    projects.map((project) => [project.id, project.name]),
  );
  const rows: SearchResult[] = [];
  for (const kind of ["tasks", "history"] as const) {
    if (category !== "all" && category !== kind) continue;
    for (const result of results[kind].data?.data ?? []) {
      rows.push({
        id: `${kind}:${result.task.id}`,
        kind,
        title: result.task.title,
        subtitle:
          projectNames.get(result.task.projectId) ??
          t("globalSearch.temporary"),
        snippet: result.snippet,
        task: result.task,
        ...(result.occurrence ? { occurrence: result.occurrence } : {}),
      });
    }
  }
  if (category === "all" || category === "files") {
    for (const file of results.files.data?.files ?? [])
      rows.push({
        id: `file:${file.projectId}:${file.rootPath}:${file.path}`,
        kind: "files",
        title: file.name,
        subtitle: `${file.projectName} · ${file.path}`,
        snippet: "",
        file,
      });
  }
  const selectedIndex = Math.max(
    0,
    rows.findIndex((row) => row.id === selectedId),
  );
  const selected = rows[selectedIndex];
  const visibleQueries =
    category === "all"
      ? [results.tasks, results.history, results.files]
      : [results[category]];
  const loading =
    normalized.length > 0 &&
    (results.waiting || visibleQueries.some((item) => item.isFetching));
  const failed = visibleQueries.some((item) => item.isError);
  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected?.id]);

  const openTask = async (task: AgentTask, occurrence?: SearchOccurrence) => {
    useHistoryLocation.getState().setLocation(
      occurrence === undefined
        ? null
        : {
            ...occurrence,
            projectId: task.projectId,
            taskId: task.id,
            query: normalized,
          },
    );
    await (task.projectId === "temporary"
      ? navigate({ to: "/temporary/t/$taskId", params: { taskId: task.id } })
      : navigate({
          to: "/p/$projectId/t/$taskId",
          params: { projectId: task.projectId, taskId: task.id },
        }));
    onClose();
  };
  const openFile = async (file: SearchFile, signal: AbortSignal) => {
    const kind = await prepareSearchFile(client, cache, file, signal);
    if (kind !== null) setPreview({ file, kind });
  };
  const activate = async (row: SearchResult) => {
    if (openingRef.current) return;
    openingRef.current = true;
    const controller = new AbortController();
    actionAbortRef.current = controller;
    setOpening(true);
    try {
      if (row.kind === "history" && row.task !== undefined) {
        // 列表已由后端校验，复用同一锚点，避免再次搜索改变点击目标。
        if (row.occurrence) await openTask(row.task, row.occurrence);
        else setHistoryTask(row.task);
      } else if (row.file !== undefined)
        await openFile(row.file, controller.signal);
      else if (row.task !== undefined) await openTask(row.task);
    } catch (error) {
      if (!controller.signal.aborted)
        notifyActionError(
          error instanceof Error ? error : new Error(String(error)),
        );
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
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className="top-[12%] max-w-[46rem] -translate-y-0 gap-0 overflow-hidden border border-separator-strong p-0 shadow-floating"
          onOpenAutoFocus={visibility.onOpenAutoFocus}
          onCloseAutoFocus={visibility.onCloseAutoFocus}
        >
          <DialogTitle className="sr-only">
            {t("globalSearch.title")}
          </DialogTitle>
          <div className="flex items-center gap-2 border-b border-separator px-4 pb-3 pt-4">
            <div className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-surface border border-separator-strong bg-control px-3 transition-[background-color,border-color,box-shadow] focus-within:border-brand focus-within:bg-panel focus-within:shadow-focus">
              <Search
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
              <Input
                ref={inputRef}
                autoComplete="off"
                spellCheck={false}
                maxLength={1024}
                aria-label={t("globalSearch.title")}
                placeholder={t("globalSearch.placeholder")}
                value={query}
                role="combobox"
                variant="embedded"
                data-global-search-input
                aria-autocomplete="list"
                aria-expanded={historyTask === null}
                aria-controls="global-search-results"
                aria-activedescendant={
                  historyTask === null && selected !== undefined
                    ? `global-search-option-${selectedIndex}`
                    : undefined
                }
                className="h-full rounded-control appearance-none border-0 bg-transparent p-0 text-body focus-visible:shadow-none"
                onCompositionStart={() => setComposing(true)}
                onCompositionEnd={() => setComposing(false)}
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                  resetPages();
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || composing) return;
                  if (
                    (event.metaKey || event.ctrlKey) &&
                    event.key.toLowerCase() === "f"
                  ) {
                    event.preventDefault();
                    event.currentTarget.select();
                    return;
                  }
                  if (historyTask !== null || rows.length === 0) return;
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    setSelectedId(
                      rows[
                        (selectedIndex +
                          (event.key === "ArrowDown" ? 1 : rows.length - 1)) %
                          rows.length
                      ]!.id,
                    );
                  } else if (event.key === "Enter" && selected !== undefined) {
                    event.preventDefault();
                    void activate(selected);
                  }
                }}
              />
              {query.length > 0 ? (
                <Button
                  aria-label={t("globalSearch.clear")}
                  className="text-muted-foreground"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => {
                    setQuery("");
                    resetPages();
                    inputRef.current?.focus();
                  }}
                >
                  <CircleX className="size-3.5" />
                </Button>
              ) : null}
            </div>
            <Button
              aria-label={t("globalSearch.close")}
              className="size-10"
              size="icon-compact"
              variant="ghost"
              onClick={onClose}
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="flex items-center gap-3 border-b border-separator px-4 py-2.5">
            <div
              className="grid grid-cols-4 rounded-control bg-control p-0.5"
              role="group"
              aria-label={t("globalSearch.categories")}
            >
              {(["all", "tasks", "history", "files"] as const).map((kind) => (
                <Button
                  key={kind}
                  className={`h-7 px-3 ${category === kind ? "bg-raised text-foreground shadow-control" : "text-muted-foreground"}`}
                  size="sm"
                  variant="ghost"
                  aria-pressed={category === kind}
                  onClick={() => {
                    setCategory(kind);
                    resetPages();
                  }}
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
              search={occurrences}
              listRef={listRef}
              onScroll={visibility.onScroll}
              task={historyTask}
              query={normalized}
              onBack={() => setHistoryTask(null)}
              onOpenTask={() => void openTask(historyTask)}
              onSelect={(occurrence) => void openTask(historyTask, occurrence)}
            />
          ) : (
            <div
              ref={listRef}
              onScroll={visibility.onScroll}
              className="max-h-[min(58vh,34rem)] min-h-72 overflow-y-auto p-2"
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
                rows={rows}
                query={normalized}
                selectedId={selected?.id}
                busy={loading || opening}
                onActivate={(row) => void activate(row)}
                onSelect={setSelectedId}
              />
              {loading ? (
                <p
                  role="status"
                  className="flex items-center justify-center gap-2 p-5 text-caption text-muted-foreground"
                >
                  <LoaderCircle className="size-3.5 animate-spin" />
                  {t("globalSearch.loading")}
                </p>
              ) : null}
              {failed ? (
                <div role="alert" className="p-3 text-caption text-danger">
                  {t("globalSearch.error")}{" "}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      for (const result of visibleQueries)
                        if (result.isError) void result.refetch();
                    }}
                  >
                    {t("globalSearch.retry")}
                  </Button>
                </div>
              ) : null}
              {!loading && !failed && normalized && rows.length === 0 ? (
                <div
                  role="status"
                  className="grid min-h-56 place-items-center px-6 text-center text-muted-foreground"
                >
                  <div>
                    <SearchX className="mx-auto mb-3 size-6 opacity-60" />
                    <p className="text-body-small">{t("globalSearch.empty")}</p>
                  </div>
                </div>
              ) : null}
              {results.files.data?.failedRoots.length ? (
                <p
                  role="alert"
                  title={results.files.data.failedRoots.join("\n")}
                  className="p-3 text-caption text-warning"
                >
                  {t("globalSearch.partial")}
                </p>
              ) : null}
              {results.files.data?.truncated ? (
                <p className="p-3 text-caption text-muted-foreground">
                  {t("globalSearch.fileLimit")}
                </p>
              ) : null}
              {(["tasks", "history"] as const).map((kind) => {
                if (category !== "all" && category !== kind) return null;
                const cursors = kind === "tasks" ? taskCursors : historyCursors;
                const setCursors =
                  kind === "tasks" ? setTaskCursors : setHistoryCursors;
                const next = results[kind].data?.nextCursor;
                if (cursors.length === 1 && !next) return null;
                return (
                  <div
                    key={kind}
                    className="mt-2 flex items-center gap-2 border-t border-separator px-3 pt-3 text-caption"
                  >
                    <span className="mr-auto text-muted-foreground">
                      {t(`globalSearch.${kind}`)}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={cursors.length === 1}
                      onClick={() =>
                        setCursors((current) => current.slice(0, -1))
                      }
                    >
                      <ChevronLeft />
                      {t("globalSearch.previous")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!next}
                      onClick={() => {
                        if (next) setCursors((current) => [...current, next]);
                      }}
                    >
                      {t("globalSearch.next")}
                      <ChevronRight />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
          {historyTask === null ? (
            <div className="flex min-h-11 items-center justify-between border-t border-separator bg-control/40 px-4 py-2 text-caption text-muted-foreground">
              <p>{t("globalSearch.resultCount", { count: rows.length })}</p>
              <span className="ml-auto mr-3">{t("globalSearch.keyboard")}</span>
              {selected?.kind === "history" && selected.task !== undefined ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setHistoryTask(selected.task!)}
                >
                  {t("globalSearch.occurrences")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      {!open || preview === null ? null : (
        <Suspense fallback={null}>
          <ProjectSourceDialog
            client={client}
            projectId={preview.file.projectId}
            rootPath={preview.file.rootPath}
            previewKind={preview.kind}
            reference={{ path: preview.file.path, lineNumber: null }}
            onClose={() => setPreview(null)}
          />
        </Suspense>
      )}
    </>
  );
}
