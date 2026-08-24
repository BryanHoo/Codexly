import type { AgentTask, AgentTaskPage, Project } from "@code-agent/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../../shared/components/core/dialog.js";
import { Input } from "../../../shared/components/core/input.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import {
  replaceProjectTaskInQueryCaches,
  taskDeleteMutationOptions,
  taskUnarchiveMutationOptions,
  upsertProjectTaskInInfiniteData,
  type CodeAgentArchivedTaskClient,
  type ProjectTaskInfiniteData,
} from "../../projects/project-queries.js";
import { archivedProjectTasksQueryOptions } from "../../projects/project-task-query-options.js";
import { deleteAllArchivedTasks } from "./archived-task-delete-all.js";
import { TaskDeleteConfirmationDialog } from "./task-delete-dialog.js";

type ArchivedTaskListViewProps = Readonly<{
  error: Error | null;
  isPending: boolean;
  mutationPending: boolean;
  onDelete: (task: AgentTask) => void;
  onDeleteAll: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onRestore: (task: AgentTask) => void;
  onRetry?: () => void;
  page: AgentTaskPage | undefined;
  pageNumber: number;
}>;

export function ArchivedTaskListView({
  error,
  isPending,
  mutationPending,
  onDelete,
  onDeleteAll,
  onNext,
  onPrevious,
  onRestore,
  onRetry,
  page,
  pageNumber,
}: ArchivedTaskListViewProps) {
  const { t } = useTranslation("workbench");

  if (isPending) {
    return (
      <div className="flex min-h-48 items-center justify-center" role="status">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">{t("archivedTasks.loading")}</span>
      </div>
    );
  }
  if (error !== null) {
    return (
      <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-body-small text-danger" role="alert">
          {t("archivedTasks.loadError")}
        </p>
        <Button onClick={onRetry} size="sm" type="button" variant="outline">
          {t("actions.retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
      {page?.data.length === 0 ? (
        <p className="flex min-h-48 items-center justify-center px-4 text-body-small text-muted-foreground">
          {t("archivedTasks.empty")}
        </p>
      ) : (
        <ul className="min-h-0 overflow-y-auto">
          {page?.data.map((task) => (
            <li className="flex min-h-14 min-w-0 items-center gap-3 px-4 py-2" key={task.id}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-small font-medium text-foreground">{task.title}</p>
                <p className="text-caption text-muted-foreground">
                  {t("archivedTasks.updatedAt", {
                    date: new Date(task.updatedAt).toLocaleString(),
                  })}
                </p>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={t("archivedTasks.restoreTask", { task: task.title })}
                    disabled={mutationPending}
                    onClick={() => {
                      onRestore(task);
                    }}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <ArchiveRestore aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("archivedTasks.restore")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={t("archivedTasks.deleteTask", { task: task.title })}
                    disabled={mutationPending}
                    onClick={() => {
                      onDelete(task);
                    }}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("archivedTasks.delete")}</TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
      <div className="flex min-h-12 items-center justify-between gap-2 px-4">
        <Button
          className="text-danger hover:text-danger"
          disabled={mutationPending}
          onClick={onDeleteAll}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Trash2 aria-hidden="true" />
          {t("archivedTasks.deleteAll")}
        </Button>
        <div className="flex items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t("archivedTasks.previous")}
                className="size-11 sm:size-8"
                disabled={mutationPending || pageNumber === 1}
                onClick={onPrevious}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("archivedTasks.previous")}</TooltipContent>
          </Tooltip>
          <span className="min-w-16 text-center text-caption text-muted-foreground">
            {t("archivedTasks.page", { page: pageNumber })}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t("archivedTasks.next")}
                className="size-11 sm:size-8"
                disabled={mutationPending || page?.nextCursor === null}
                onClick={onNext}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("archivedTasks.next")}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

export function ArchivedTasksDialog({
  client,
  onClose,
  project,
}: Readonly<{
  client: CodeAgentArchivedTaskClient;
  onClose: () => void;
  project: Project;
}>) {
  const { t } = useTranslation("workbench");
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [deletingTask, setDeletingTask] = useState<AgentTask | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const actionLockRef = useRef(createAsyncActionLock());
  const cursor = cursors[pageIndex];
  const tasksQuery = useQuery(
    archivedProjectTasksQueryOptions(project.id, cursor, searchTerm, client),
  );
  const unarchiveMutation = useMutation(taskUnarchiveMutationOptions(client));
  const deleteMutation = useMutation(taskDeleteMutationOptions(client));
  const deleteAllMutation = useMutation({
    mutationFn: () => deleteAllArchivedTasks(client, project.id),
    mutationKey: ["tasks", "delete-all-archived", project.id] as const,
  });
  const mutationPending =
    unarchiveMutation.isPending || deleteMutation.isPending || deleteAllMutation.isPending;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearchTerm(query.trim());
      setCursors([undefined]);
      setPageIndex(0);
    }, 250);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [query]);

  const resetArchivedPages = () => {
    // Mutation 会使 opaque cursor 失效，因此统一回到第一页并丢弃旧页缓存。
    setCursors([undefined]);
    setPageIndex(0);
    queryClient.removeQueries({ queryKey: ["projects", project.id, "archived-tasks"] });
  };

  const restoreTask = (task: AgentTask) =>
    actionLockRef.current.run(async () => {
      try {
        const response = await unarchiveMutation.mutateAsync({
          projectId: project.id,
          taskId: task.id,
        });
        queryClient.setQueryData<ProjectTaskInfiniteData>(
          ["projects", project.id, "tasks"],
          (currentData) => upsertProjectTaskInInfiniteData(currentData, response.task),
        );
        replaceProjectTaskInQueryCaches(queryClient, response.task);
        resetArchivedPages();
      } catch {
        // 根级 MutationCache 已展示 Provider 原始错误。
      }
    });

  const deleteTask = (task: AgentTask) =>
    actionLockRef.current.run(async () => {
      try {
        await deleteMutation.mutateAsync({ projectId: project.id, taskId: task.id });
        setDeletingTask(null);
        resetArchivedPages();
      } catch {
        // 保留确认 Dialog，允许用户直接重试。
      }
    });

  const deleteAllTasks = () =>
    actionLockRef.current.run(async () => {
      try {
        await deleteAllMutation.mutateAsync();
        setDeleteAllOpen(false);
      } catch {
        // 保留确认 Dialog，根级 MutationCache 展示单一批量错误。
      } finally {
        resetArchivedPages();
      }
    });

  return (
    <>
      <Dialog
        onOpenChange={(open) => {
          if (!open && !mutationPending) onClose();
        }}
        open
      >
        <DialogContent className="grid h-[min(42rem,calc(100dvh-2rem))] max-w-2xl grid-rows-[auto_auto_minmax(0,1fr)] gap-0 overflow-hidden p-0">
          <DialogHeader className="px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
            <DialogTitle>{t("archivedTasks.title", { project: project.name })}</DialogTitle>
          </DialogHeader>
          <div className="relative px-4 pb-3 sm:px-5">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-7 top-2.5 size-4 text-muted-foreground sm:left-8"
            />
            <Input
              aria-label={t("archivedTasks.search")}
              className="h-9 w-full pl-8"
              onChange={(event) => {
                setQuery(event.currentTarget.value);
              }}
              placeholder={t("archivedTasks.search")}
              value={query}
            />
          </div>
          <ArchivedTaskListView
            error={tasksQuery.error}
            isPending={tasksQuery.isPending}
            mutationPending={mutationPending}
            onDelete={setDeletingTask}
            onDeleteAll={() => {
              setDeleteAllOpen(true);
            }}
            onNext={() => {
              const nextCursor = tasksQuery.data?.nextCursor;
              if (nextCursor === null || nextCursor === undefined) return;
              setCursors((current) => [...current.slice(0, pageIndex + 1), nextCursor]);
              setPageIndex((current) => current + 1);
            }}
            onPrevious={() => {
              setPageIndex((current) => Math.max(0, current - 1));
            }}
            onRestore={(task) => {
              void restoreTask(task);
            }}
            onRetry={() => {
              void tasksQuery.refetch();
            }}
            page={tasksQuery.data}
            pageNumber={pageIndex + 1}
          />
        </DialogContent>
      </Dialog>
      {deletingTask === null ? null : (
        <TaskDeleteConfirmationDialog
          confirmLabel={t("archivedTasks.confirmDelete")}
          description={t("archivedTasks.deleteDescription", { task: deletingTask.title })}
          isPending={deleteMutation.isPending}
          onClose={() => {
            setDeletingTask(null);
          }}
          onConfirm={() => {
            void deleteTask(deletingTask);
          }}
          title={t("archivedTasks.deleteTitle")}
        />
      )}
      {deleteAllOpen ? (
        <TaskDeleteConfirmationDialog
          confirmLabel={t("archivedTasks.confirmDeleteAll")}
          description={t("archivedTasks.deleteAllDescription", { project: project.name })}
          isPending={deleteAllMutation.isPending}
          onClose={() => {
            setDeleteAllOpen(false);
          }}
          onConfirm={() => {
            void deleteAllTasks();
          }}
          title={t("archivedTasks.deleteAllTitle")}
        />
      ) : null}
    </>
  );
}
