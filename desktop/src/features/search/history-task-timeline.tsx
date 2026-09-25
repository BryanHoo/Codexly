import "./global-search.css";
import "../../i18n/global-search.js";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { LoaderCircle, MapPin, RotateCcw } from "lucide-react";
import { createTaskStore } from "../conversation/runtime/task-store.js";
import { useProjectData } from "../projects/project-context.js";
import { TaskStoreTimeline } from "../workbench/components/task-timeline-store.js";
import { Button } from "../../shared/components/core/button.js";
import { useTranslation } from "../../i18n/i18n.js";
import type { MessageFileReference } from "../../shared/components/agent/message.js";
import type { AgentFileChange } from "../diff/file-change.js";
import {
  useHistoryLocation,
  type HistoryLocation,
} from "./history-location.js";
import { SearchHighlight } from "./search-highlight.js";
import { resolveHistoryTarget } from "./history-target.js";

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
    queryKey: [
      "search-history-location",
      location.projectId,
      location.taskId,
      location.turnCursor,
    ],
    queryFn: ({ signal }) =>
      client.readTask(location.projectId, location.taskId, {
        cursor: location.turnCursor,
        signal,
      }),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const store = useMemo(
    () =>
      page.data === undefined
        ? null
        : createTaskStore(
            { projectId: location.projectId, taskId: location.taskId },
            page.data,
          ),
    [location.projectId, location.taskId, page.data],
  );
  const target = useMemo(
    () =>
      page.data === undefined
        ? null
        : resolveHistoryTarget(page.data.snapshot, location),
    [location, page.data],
  );
  return (
    <>
      <div className="flex shrink-0 items-center gap-3 border-b border-separator bg-control px-4 py-2.5 text-body-small">
        <span className="grid size-8 shrink-0 place-items-center rounded-control bg-raised text-brand shadow-sm">
          <MapPin aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-caption text-muted-foreground">
            {t("globalSearch.location")}
          </p>
          <p className="truncate">
            <SearchHighlight
              text={location.snippet}
              query={location.query}
              range={location.snippetMatchRange}
            />
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => useHistoryLocation.getState().setLocation(null)}
        >
          <RotateCcw />
          {t("globalSearch.latest")}
        </Button>
      </div>
      {page.isPending ? (
        <p
          role="status"
          className="flex items-center justify-center gap-2 p-6 text-caption text-muted-foreground"
        >
          <LoaderCircle className="size-3.5 animate-spin" />
          {t("globalSearch.loading")}
        </p>
      ) : null}
      {page.isError ? (
        <div
          role="alert"
          className="m-4 rounded-surface bg-control px-4 py-3 text-body-small text-danger"
        >
          {t("globalSearch.error")}{" "}
          <Button variant="ghost" size="sm" onClick={() => void page.refetch()}>
            {t("globalSearch.retry")}
          </Button>
        </div>
      ) : null}
      {page.data !== undefined && target === null ? (
        <p
          role="alert"
          className="m-4 rounded-surface bg-control px-4 py-3 text-body-small text-muted-foreground"
        >
          {t("globalSearch.unavailable")}
        </p>
      ) : null}
      {store !== null && target !== null ? (
        <TaskStoreTimeline
          connected={false}
          store={store}
          searchTarget={target}
          onOpenFileDiff={onOpenFileDiff}
          onOpenSourceFile={onOpenSourceFile}
          onReviewFileChanges={onReviewFileChanges}
          onResolvePendingRequest={ignoreRequest}
        />
      ) : null}
    </>
  );
}
