import {
  submitTask,
  TaskSubmissionError,
  type TaskSubmissionRepository,
  type TaskSubmissionRecord,
  type AcpSubmissionIntent,
} from "@codexly/core";
import type { SubmitTaskRequest } from "@codexly/protocol";
import { ProjectRootScopeError, resolveProjectRoot } from "./project-root-scope.js";
import { MutationHttpError, type ServerRouteContext } from "./routes/context.js";
import { retainTaskExecution } from "./task-execution-lifecycle.js";

export function createMemorySubmissionRepository(capacity: number): TaskSubmissionRepository {
  const records = new Map<string, TaskSubmissionRecord>();
  const intents = new Map<string, AcpSubmissionIntent>();
  const save = (projectId: string, key: string, record: TaskSubmissionRecord) => {
    const id = JSON.stringify([projectId, key]);
    if (!records.has(id) && records.size >= capacity)
      throw new MutationHttpError(
        "IDEMPOTENCY_CAPACITY_EXCEEDED",
        "Submission recovery capacity is exhausted",
        503,
      );
    records.set(id, structuredClone(record));
  };
  return {
    claimSubmission(projectId, key, expected, next) {
      const current = records.get(JSON.stringify([projectId, key]));
      if (next.stage !== "creating" && next.stage !== "starting") return Promise.resolve(false);
      if (
        expected &&
        (expected.stage !== "ready" ||
          expected.result !== undefined ||
          expected.fingerprint !== next.fingerprint ||
          (next.stage === "creating" && expected.task))
      )
        return Promise.resolve(false);
      if (
        expected
          ? !current ||
            current.stage !== expected.stage ||
            current.fingerprint !== expected.fingerprint ||
            current.task?.id !== expected.task?.id ||
            current.result !== undefined
          : current !== undefined
      )
        return Promise.resolve(false);
      save(projectId, key, next);
      return Promise.resolve(true);
    },
    readSubmission(projectId, key) {
      return Promise.resolve(records.get(JSON.stringify([projectId, key])));
    },
    writeSubmission(projectId, key, record) {
      save(projectId, key, record);
      return Promise.resolve();
    },
    writeAcpSubmission(projectId, key, record, intent) {
      save(projectId, key, record);
      intents.set(JSON.stringify([projectId, key]), structuredClone(intent));
      return Promise.resolve();
    },
    recoverAcpSubmission(projectId, sourceKey, key, fingerprint, intent) {
      const sourceId = JSON.stringify([projectId, sourceKey]),
        id = JSON.stringify([projectId, key]);
      const source = records.get(sourceId),
        metadata = intents.get(sourceId);
      if (
        sourceKey === key ||
        records.has(id) ||
        !metadata ||
        metadata.engine !== intent.engine ||
        metadata.workspacePath !== intent.workspacePath ||
        source?.stage !== "ready" ||
        !source.task
      )
        return Promise.resolve(undefined);
      // 同一同步片段完成转交，不能在两次写入之间 await 让出执行权。
      const next: TaskSubmissionRecord = { fingerprint, stage: "ready", task: source.task };
      save(projectId, key, next);
      intents.set(id, structuredClone(intent));
      save(projectId, sourceKey, { ...source, stage: "starting" });
      return Promise.resolve(structuredClone(next));
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
  let workspacePath: string | undefined;
  let prepared: Awaited<ReturnType<ServerRouteContext["resolveProviderTurnInput"]>> | undefined;
  let release =
    input.taskId === undefined ? undefined : await retainTaskExecution(runtime, input.taskId);
  try {
    return await submitTask(repository, projectId, key, context.fingerprintPayload(input), input, {
      validate: async () => {
        if (input.type !== "review" && input.workspacePath !== undefined) {
          if (input.taskId !== undefined)
            throw new MutationHttpError(
              "INVALID_REQUEST",
              "Existing task workspace cannot change",
              400,
            );
          try {
            // 只接受项目根或 Git 已登记的工作树，禁止客户端为新任务指定任意目录。
            workspacePath = await resolveProjectRoot(
              context.projectRepository,
              projectId,
              input.workspacePath,
            );
          } catch (error) {
            if (error instanceof ProjectRootScopeError)
              throw new MutationHttpError("INVALID_REQUEST", "Project workspace is invalid", 400);
            throw error;
          }
        }
        let engine = input.type !== "review" ? (input.engine ?? "codex") : "codex";
        if (input.taskId !== undefined) {
          const task = await runtime.provider.readTask(input.taskId);
          if (task?.projectId !== runtime.scope.id)
            throw new MutationHttpError("TASK_NOT_FOUND", "Task not found", 404);
          engine = task.engine ?? "codex";
          if (input.type !== "review" && input.engine !== undefined && input.engine !== engine)
            throw new MutationHttpError("INVALID_REQUEST", "Task engine is immutable", 400);
        }
        if (input.type === "prompt") {
          if (input.options.engineOptions && input.options.engineOptions.engine !== engine)
            throw new MutationHttpError("INVALID_REQUEST", "Options belong to another engine", 400);
          context.assertValidProjectDefaults(await context.listModels(engine), input.options);
        }
        if (input.type === "acp-prompt" && !runtime.provider.startConfiguredTurn)
          throw new MutationHttpError("PROVIDER_ERROR", "ACP prompt is unavailable", 503);
      },
      createTask: () =>
        input.type !== "review" && (input.engine || workspacePath !== undefined)
          ? runtime.provider.startTask({
              ...(input.engine ? { engine: input.engine } : {}),
              ...(workspacePath === undefined ? {} : { workspacePath }),
            })
          : runtime.provider.startTask(),
      prepare: async (taskId) => {
        // 新任务或失败恢复直到这里才拿到 ID，也必须覆盖设置和附件准备阶段。
        release ??= await retainTaskExecution(runtime, taskId);
        // ACP 配置由会话持有；旧设置仓储不参与读取或回写，避免覆盖已协商选择。
        if (input.type !== "acp-prompt") {
          const settings =
            input.type === "prompt"
              ? input.options
              : await context.readEffectiveTaskSettings(projectId, taskId);
          await context.settingsRepository.writeTaskSettings(projectId, taskId, settings);
        }
        if (input.type !== "review")
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
        if (input.type === "acp-prompt") {
          if (!runtime.provider.startConfiguredTurn) throw new Error("ACP prompt is unavailable");
          const turn =
            "initialConfig" in input
              ? await runtime.provider.startConfiguredTurn(
                  taskId,
                  prepared.providerInput,
                  input.initialConfig,
                )
              : await runtime.provider.startConfiguredTurn(taskId, prepared.providerInput);
          return { taskId, turn, checkpoint };
        }
        const turn = await runtime.provider.startTurn(
          taskId,
          prepared.providerInput,
          input.options,
        );
        return { taskId, turn, checkpoint };
      },
      complete: async (result, attachmentIds) => {
        if (input.type !== "review")
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
  } finally {
    release?.();
  }
}
