import "./global-search.css";

import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, MapPin, RotateCcw } from "lucide-react";
import { useMemo } from "react";

import { useTranslation } from "../../i18n/i18n.js";
import type { MessageFileReference } from "../../shared/components/agent/message.js";
import { Button } from "../../shared/components/core/button.js";
import { createTaskStore } from "../conversation/runtime/task-store.js";
import type { AgentFileChange } from "../diff/file-change.js";
import { useProjectData } from "../projects/project-context.js";
import { TaskStoreTimeline } from "../workbench/components/task-timeline-store.js";
import { useHistoryLocation, type HistoryLocation } from "./history-location.js";
import { resolveHistoryTarget } from "./history-target.js";
import { SearchHighlight } from "./search-highlight.js";

const ignoreDiff = (_change: AgentFileChange) => undefined;
const ignoreFile = (_reference: MessageFileReference) => undefined;
const ignoreChanges = (_changes: readonly AgentFileChange[]) => undefined;
const ignoreRequest = () => Promise.resolve();

export function HistoryTaskTimeline({
  location,
  onOpenFileDiff = ignoreDiff,
  onOpenSourceFile = ignoreFile,
  onReviewFileChanges = ignoreChanges,
}: Readonly<{
  location: HistoryLocation;
  onOpenFileDiff?: (change: AgentFileChange) => void;
  onOpenSourceFile?: (reference: MessageFileReference) => void;
  onReviewFileChanges?: (changes: readonly AgentFileChange[]) => void;
}>) {
  const { client } = useProjectData();
  const { t } = useTranslation("workbench");
  const page = useQuery({
    gcTime: 0,
    queryFn: ({ signal }) =>
      client.readTask(location.projectId, location.taskId, {
        cursor: location.turnCursor,
        signal,
      }),
    queryKey: ["search-history-location", location.projectId, location.taskId, location.turnCursor],
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 0,
  });
  const store = useMemo(
    () =>
      page.data === undefined
        ? null
        : createTaskStore({ projectId: location.projectId, taskId: location.taskId }, page.data),
    [location.projectId, location.taskId, page.data],
  );
  const target = useMemo(
    () => (page.data === undefined ? null : resolveHistoryTarget(page.data.snapshot, location)),
    [location, page.data],
  );
  return (
    <>
      <div className="flex shrink-0 items-center gap-3 border-b border-separator bg-control px-4 py-2.5 text-body-small">
        <span className="grid size-8 shrink-0 place-items-center rounded-control bg-raised text-brand shadow-sm">
          <MapPin aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-caption text-muted-foreground">{t("globalSearch.location")}</p>
          <p className="truncate">
            <SearchHighlight
              query={location.query}
              range={location.snippetMatchRange}
              text={location.snippet}
            />
          </p>
        </div>
        <Button
          onClick={() => {
            useHistoryLocation.getState().setLocation(null);
          }}
          size="sm"
          variant="ghost"
        >
          <RotateCcw />
          {t("globalSearch.latest")}
        </Button>
      </div>
      {page.isPending ? (
        <p
          className="flex items-center justify-center gap-2 p-6 text-caption text-muted-foreground"
          role="status"
        >
          <LoaderCircle className="size-3.5 animate-spin" />
          {t("globalSearch.loading")}
        </p>
      ) : null}
      {page.isError ? (
        <div
          className="m-4 rounded-surface bg-control px-4 py-3 text-body-small text-danger"
          role="alert"
        >
          {t("globalSearch.error")}{" "}
          <Button onClick={() => void page.refetch()} size="sm" variant="ghost">
            {t("globalSearch.retry")}
          </Button>
        </div>
      ) : null}
      {page.data !== undefined && target === null ? (
        <p
          className="m-4 rounded-surface bg-control px-4 py-3 text-body-small text-muted-foreground"
          role="alert"
        >
          {t("globalSearch.unavailable")}
        </p>
      ) : null}
      {store !== null && target !== null ? (
        <TaskStoreTimeline
          connected={false}
          onOpenFileDiff={onOpenFileDiff}
          onOpenSourceFile={onOpenSourceFile}
          onResolvePendingRequest={ignoreRequest}
          onReviewFileChanges={onReviewFileChanges}
          searchTarget={target}
          store={store}
        />
      ) : null}
    </>
  );
}
