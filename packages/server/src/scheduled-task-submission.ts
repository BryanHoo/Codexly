import {
  submitTask,
  type TaskSubmissionRecord,
  type TaskSubmissionRepository,
} from "@codexly/core";
import type { AgentModel, ScheduledTask, ScheduledTaskRun } from "@codexly/protocol";
import type { AttachmentStore } from "./attachment-store.js";
import type { ScheduledTaskAttachmentManager } from "./scheduled-task-attachments.js";
import type { CreateCodexlyServerOptions } from "./server-options.js";
import type { ProjectContextResolver, ServerRouteContext } from "./routes/context.js";
import { assertValidProjectDefaults, fingerprintPayload } from "./server-runtime.js";
import { ScheduledTaskLaunchError } from "./scheduled-task-outcome.js";

export function createScheduledSubmission(
  repository: TaskSubmissionRepository,
  settingsRepository: CreateCodexlyServerOptions["settingsRepository"],
  attachmentStore: AttachmentStore,
  manager: ScheduledTaskAttachmentManager | undefined,
  getProjectContext: ProjectContextResolver,
  listModels: () => Promise<readonly AgentModel[]>,
  resolveInput: ServerRouteContext["resolveProviderTurnInput"],
) {
  // 已确认启动但数据库临时不可写时保留结果，重试只能落库与清理。
  const pendingResults = new Map<string, TaskSubmissionRecord>();
  const keyFor = (run: ScheduledTaskRun) => `scheduled:${run.id}`;

  async function startTask(scheduled: ScheduledTask): Promise<string> {
    const run = scheduled.runs.findLast(
      (item) => item.status === "running" || item.status === "cleanup_pending",
    );
    if (run === undefined) throw new Error("Scheduled run is unavailable");
    const key = keyFor(run);
    const input = {
      type: "prompt" as const,
      input: scheduled.prompt,
      options: scheduled.turnOptions,
    };
    const fingerprint = fingerprintPayload(input);
    let restored: { prompt: ScheduledTask["prompt"]; restoredIds: readonly string[] } | undefined;
    let previous: TaskSubmissionRecord | undefined;
    let createdTask: TaskSubmissionRecord["task"];
    try {
      const pending = pendingResults.get(key);
      if (pending !== undefined)
        await repository.writeSubmission(scheduled.projectId, key, pending);
      previous = await repository.readSubmission(scheduled.projectId, key);
      const context = await getProjectContext(scheduled.projectId);
      if (context === undefined) throw new Error("Scheduled task project was not found");
      createdTask = previous?.task;
      let prepared: Awaited<ReturnType<typeof resolveInput>> | undefined;
      const result = await submitTask(repository, scheduled.projectId, key, fingerprint, input, {
        validate: async () => {
          assertValidProjectDefaults(await listModels(), scheduled.turnOptions);
          // 附件恢复先于创建 Task，损坏的持久内容不会生成孤儿任务。
          restored =
            manager === undefined
              ? { prompt: scheduled.prompt, restoredIds: [] }
              : await manager.restorePrompt(scheduled);
        },
        createTask: async () => {
          createdTask = await context.provider.startTask();
          return createdTask;
        },
        prepare: async (taskId) => {
          await settingsRepository.writeTaskSettings(
            scheduled.projectId,
            taskId,
            scheduled.turnOptions,
          );
          if (restored === undefined) throw new Error("Scheduled attachments are unavailable");
          prepared = await resolveInput(
            scheduled.projectId,
            restored.prompt,
            context.provider,
            taskId,
          );
          return prepared.attachmentIds;
        },
        execute: async (taskId) => {
          if (prepared === undefined) throw new Error("Scheduled input is unavailable");
          const checkpoint = context.eventStream.checkpoint;
          const turn = await context.provider.startTurn(
            taskId,
            prepared.providerInput,
            scheduled.turnOptions,
          );
          const result = {
            taskId,
            turn,
            checkpoint,
            ...(createdTask === undefined ? {} : { createdTask }),
          };
          pendingResults.set(key, {
            fingerprint,
            stage: "started",
            result,
            attachmentIds: prepared.attachmentIds,
            ...(createdTask === undefined ? {} : { task: createdTask }),
          });
          return result;
        },
        complete: (result, ids) =>
          attachmentStore.consume(
            scheduled.projectId,
            ids,
            result.turn.status === "running" ? result.turn.id : undefined,
          ),
      });
      pendingResults.delete(key);
      return result.taskId;
    } catch {
      let record = pendingResults.get(key);
      try {
        record ??= await repository.readSubmission(scheduled.projectId, key);
      } catch {
        // 无法读取执行标记时不能猜测未执行；保持未知状态以禁止重发。
        throw new ScheduledTaskLaunchError(
          record?.result === undefined ? "unknown" : "cleanup_pending",
          record?.result?.taskId ?? createdTask?.id ?? previous?.task?.id ?? run.taskId,
        );
      }
      const status =
        record?.result !== undefined
          ? "cleanup_pending"
          : record?.stage === "creating" || record?.stage === "starting"
            ? "unknown"
            : "failed";
      if (status === "failed")
        await manager?.discard(restored?.restoredIds ?? []).catch(() => undefined);
      throw new ScheduledTaskLaunchError(
        status,
        record?.result?.taskId ?? createdTask?.id ?? record?.task?.id ?? run.taskId,
      );
    }
  }

  async function recoverTask(task: ScheduledTask): Promise<ScheduledTask> {
    if (!task.runs.some((run) => ["running", "unknown", "cleanup_pending"].includes(run.status)))
      return task;
    const runs = await Promise.all(
      task.runs.map(async (run): Promise<ScheduledTaskRun> => {
        if (!["running", "unknown", "cleanup_pending"].includes(run.status)) return run;
        const record = await repository.readSubmission(task.projectId, keyFor(run));
        const taskId = record?.result?.taskId ?? record?.task?.id ?? run.taskId;
        const status =
          record?.stage === "completed"
            ? "started"
            : record?.result !== undefined
              ? "cleanup_pending"
              : record?.stage === "ready"
                ? "failed"
                : "unknown";
        return {
          ...run,
          status,
          taskId,
          finishedAtUnixMs: run.finishedAtUnixMs ?? Date.now(),
          error: status === "started" ? null : new ScheduledTaskLaunchError(status, taskId).message,
        };
      }),
    );
    return {
      ...task,
      runs,
      lastRunStatus: runs.at(-1)?.status ?? task.lastRunStatus,
      ...(runs.some((run) => run.status === "unknown")
        ? { enabled: false, nextRunAtUnixMs: null }
        : {}),
    };
  }
  return { recoverTask, startTask };
}
