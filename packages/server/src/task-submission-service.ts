import {
  submitTask,
  TaskSubmissionError,
  type TaskSubmissionRepository,
  type TaskSubmissionRecord,
} from "@codexly/core";
import type { SubmitTaskRequest } from "@codexly/protocol";
import { MutationHttpError, type ServerRouteContext } from "./routes/context.js";

export function createMemorySubmissionRepository(capacity: number): TaskSubmissionRepository {
  const records = new Map<string, TaskSubmissionRecord>();
  return {
    readSubmission(projectId, key) {
      return Promise.resolve(records.get(JSON.stringify([projectId, key])));
    },
    writeSubmission(projectId, key, record) {
      const id = JSON.stringify([projectId, key]);
      if (!records.has(id) && records.size >= capacity) {
        throw new MutationHttpError(
          "IDEMPOTENCY_CAPACITY_EXCEEDED",
          "Submission recovery capacity is exhausted",
          503,
        );
      }
      records.set(id, structuredClone(record));
      return Promise.resolve();
    },
  };
}

export async function executeTaskSubmission(
  context: ServerRouteContext,
  repository: TaskSubmissionRepository,
  projectId: string,
  key: string,
  input: SubmitTaskRequest,
) {
  const runtime = await context.getProjectContext(projectId);
  if (runtime === undefined)
    throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
  let prepared: Awaited<ReturnType<ServerRouteContext["resolveProviderTurnInput"]>> | undefined;
  try {
    return await submitTask(repository, projectId, key, context.fingerprintPayload(input), input, {
      validate: async () => {
        if (input.type === "prompt")
          context.assertValidProjectDefaults(await context.listModels(), input.options);
        if (input.taskId !== undefined) {
          const task = await runtime.provider.readTask(input.taskId);
          if (task?.projectId !== runtime.scope.id)
            throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
        }
      },
      createTask: () => runtime.provider.startTask(),
      prepare: async (taskId) => {
        const settings =
          input.type === "prompt"
            ? input.options
            : await context.readEffectiveTaskSettings(projectId, taskId);
        await context.settingsRepository.writeTaskSettings(projectId, taskId, settings);
        if (input.type === "prompt")
          prepared = await context.resolveProviderTurnInput(
            projectId,
            input.input,
            runtime.provider,
            taskId,
          );
        return prepared?.attachmentIds ?? [];
      },
      execute: async (taskId) => {
        const checkpoint = runtime.eventStream.checkpoint;
        if (input.type === "review") {
          const turn = await runtime.provider.startReview(taskId, input.target);
          return { taskId, turn, checkpoint };
        }
        if (prepared === undefined) throw new Error("Submission input is unavailable");
        const turn = await runtime.provider.startTurn(
          taskId,
          prepared.providerInput,
          input.options,
        );
        return { taskId, turn, checkpoint };
      },
      complete: async (result, attachmentIds) => {
        if (input.type === "prompt")
          await context.attachmentStore.consume(
            projectId,
            attachmentIds,
            result.turn.status === "running" ? result.turn.id : undefined,
          );
      },
    });
  } catch (error) {
    if (error instanceof TaskSubmissionError)
      throw new MutationHttpError(error.code, error.message, 409);
    throw error;
  }
}
