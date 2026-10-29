import { LoadingSkeleton } from "@codexly/ui/core/loading-skeleton";
import type { DeleteArchivedTasksRequest } from "@codexly/protocol";
import { ArchivedTaskDeleteControl } from "@codexly/ui/core/archived-task-delete-control";
import type { AgentTask, AgentTaskPage, Project } from "@codexly/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveRestore, ChevronLeft, ChevronRight, Search, Trash2 } from "lucide-react";
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
  cacheRemovedProjectTask,
  cacheUnarchivedProjectTask,
  taskDeleteMutationOptions,
  taskUnarchiveMutationOptions,
  type CodexlyArchivedTaskClient,
} from "../../projects/project-queries.js";
import { archivedProjectTasksQueryOptions } from "../../projects/project-task-query-options.js";
import { TaskDeleteConfirmationDialog } from "./task-delete-dialog.js";

export type ArchivedTaskScope = Readonly<Pick<Project, "id" | "name">>;

type ArchivedTaskListViewProps = Readonly<{
  error: Error | null;
  isPending: boolean;
  mutationPending: boolean;
  onDelete: (task: AgentTask) => void;
  onDeleteAll: (updatedBefore?: string) => void;
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

  // 搜索和翻页加载只替换列表内容，保持范围选择器挂载，避免清理范围被重置为“全部”。
  const content = isPending ? (
    <LoadingSkeleton className="min-h-48 px-4 py-2" label={t("archivedTasks.loading")} />
  ) : error !== null ? (
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-body-small text-danger" role="alert">
        {t("archivedTasks.loadError")}
      </p>
      <Button onClick={onRetry} size="sm" type="button" variant="outline">
        {t("actions.retry")}
      </Button>
    </div>
  ) : page?.data.length === 0 ? (
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
  );

  return (
    <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
      {content}
      {/* 底栏保持单行；窄屏空间不足时仅在底栏内横向滚动，避免分页换行或控件重叠。 */}
      <div className="flex min-h-12 min-w-0 items-center justify-between gap-3 overflow-x-auto px-4 py-2">
        <ArchivedTaskDeleteControl
          disabled={mutationPending || isPending || error !== null}
          labels={{
            range: t("archivedTasks.deleteRange"),
            all: t("archivedTasks.rangeAll"),
            month: t("archivedTasks.rangeMonth"),
            threeMonths: t("archivedTasks.rangeThreeMonths"),
            sixMonths: t("archivedTasks.rangeSixMonths"),
            year: t("archivedTasks.rangeYear"),
            deleteAll: t("archivedTasks.deleteAll"),
            deleteBefore: t("archivedTasks.deleteBefore"),
          }}
          onDelete={onDeleteAll}
        />
        <div className="flex shrink-0 items-center gap-1 whitespace-nowrap sm:gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t("archivedTasks.previous")}
                className="size-11 sm:size-8"
                disabled={mutationPending || isPending || error !== null || pageNumber === 1}
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
          <span className="min-w-10 text-center text-caption text-muted-foreground sm:min-w-16">
            {t("archivedTasks.page", { page: pageNumber })}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t("archivedTasks.next")}
                className="size-11 sm:size-8"
                disabled={
                  mutationPending || isPending || error !== null || page?.nextCursor == null
                }
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
  client: CodexlyArchivedTaskClient;
  onClose: () => void;
  project: ArchivedTaskScope;
}>) {
  const { t } = useTranslation("workbench");
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [deletingTask, setDeletingTask] = useState<AgentTask | null>(null);
  const [deleteSelection, setDeleteSelection] = useState<DeleteArchivedTasksRequest | null>(null);
  const actionLockRef = useRef(createAsyncActionLock());
  const cursor = cursors[pageIndex];
  const tasksQuery = useQuery(
    archivedProjectTasksQueryOptions(project.id, cursor, searchTerm, client),
  );
  const unarchiveMutation = useMutation(taskUnarchiveMutationOptions(client));
  const deleteMutation = useMutation(taskDeleteMutationOptions(client));
  const deleteAllMutation = useMutation({
    mutationFn: async (selection: DeleteArchivedTasksRequest) => {
      const result = await client.deleteArchivedTasks(project.id, selection);
      if (result.failedCount > 0)
        throw new Error(t("archivedTasks.deleteAllPartialFailure", result));
      return result;
    },
    mutationKey: ["tasks", "delete-all-archived", project.id] as const,
  });
  const mutationPending =
    unarchiveMutation.isPending || deleteMutation.isPending || deleteAllMutation.isPending;

  useEffect(() => {
    const nextSearchTerm = query.trim();
    // 初次挂载或搜索词未变时，不能用防抖回调覆盖用户当前页。
    if (nextSearchTerm === searchTerm) return;
    const timeout = window.setTimeout(() => {
      setSearchTerm(nextSearchTerm);
      setCursors([undefined]);
      setPageIndex(0);
    }, 250);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [query, searchTerm]);

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
        cacheUnarchivedProjectTask(queryClient, project.id, response.tasks);
        resetArchivedPages();
      } catch {
        // 根级 MutationCache 已展示 Provider 原始错误。
      }
    });

  const deleteTask = (task: AgentTask) =>
    actionLockRef.current.run(async () => {
      try {
        const response = await deleteMutation.mutateAsync({
          projectId: project.id,
          taskId: task.id,
        });
        cacheRemovedProjectTask(queryClient, project.id, response.taskId, response.tasks);
        setDeletingTask(null);
        resetArchivedPages();
      } catch {
        // 保留确认 Dialog，允许用户直接重试。
      }
    });

  const deleteAllTasks = () =>
    actionLockRef.current.run(async () => {
      try {
        // 确认弹窗打开时已固定截止日期，确认及失败重试均复用同一范围。
        if (deleteSelection === null) return;
        await deleteAllMutation.mutateAsync(deleteSelection);
        setDeleteSelection(null);
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
        <DialogContent
          className="grid h-[min(42rem,calc(100dvh-2rem))] max-w-2xl grid-rows-[auto_auto_minmax(0,1fr)] gap-0 overflow-hidden p-0"
          closeDisabled={mutationPending}
          closeLabel={t("actions.close")}
        >
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
            onDeleteAll={(updatedBefore) => {
              setDeleteSelection(updatedBefore === undefined ? {} : { updatedBefore });
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
      {deleteSelection !== null ? (
        <TaskDeleteConfirmationDialog
          confirmLabel={t(
            deleteSelection.updatedBefore === undefined
              ? "archivedTasks.confirmDeleteAll"
              : "archivedTasks.confirmDelete",
          )}
          description={
            deleteSelection.updatedBefore === undefined
              ? t("archivedTasks.deleteAllDescription", { project: project.name })
              : t("archivedTasks.deleteBeforeDescription", {
                  project: project.name,
                  date: new Date(deleteSelection.updatedBefore).toLocaleDateString(),
                })
          }
          isPending={deleteAllMutation.isPending}
          onClose={() => {
            setDeleteSelection(null);
          }}
          onConfirm={() => {
            void deleteAllTasks();
          }}
          title={t(
            deleteSelection.updatedBefore === undefined
              ? "archivedTasks.deleteAllTitle"
              : "archivedTasks.deleteBeforeTitle",
          )}
        />
      ) : null}
    </>
  );
}
