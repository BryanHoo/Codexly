import {
  submitTask,
  type AcpPlanRun,
  type AcpPlanCompletion,
  type LocalCatalogStore,
  type TaskSubmissionRecord,
  type TaskSubmissionRepository,
} from "@codexly/core";
import type { SubmitTaskRequest } from "@codexly/protocol";
import { createHash } from "node:crypto";
import type { ProjectContextResolver, ServerRouteContext } from "./routes/context.js";
import { fingerprintPayload } from "./server-runtime.js";
import type { AcpPlanResourceManager } from "./acp-plan-resource-transfer.js";
export interface AcpPlanExecutorPorts {
  catalog: LocalCatalogStore;
  submissions: TaskSubmissionRepository;
  getProjectContext: ProjectContextResolver;
  resolveInput: ServerRouteContext["resolveProviderTurnInput"];
  resources?: Pick<AcpPlanResourceManager, "restore" | "releaseOwner">;
}
export function acpPlanSubmissionKey(scheduleId: string, runId: string) {
  return `acp-plan:web:${createHash("sha256")
    .update(JSON.stringify([scheduleId, runId]))
    .digest("hex")}`;
}

/** 领取记录先占用发送权；恢复未知只读取账本，不能用“没有找到记录”推断可以重发。 */
export function createAcpPlanExecutor(ports: AcpPlanExecutorPorts) {
  const { catalog, submissions, getProjectContext, resolveInput, resources } = ports;
  return async (scheduleId: string, runId: string): Promise<AcpPlanRun | null> => {
    const key = { source: "web" as const, scheduleId, runId };
    let run = await catalog.catalog("acp.plan.readRun", key);
    if (!run || run.status === "started" || run.status === "failed") return run;
    const owned =
      run.status === "claimed"
        ? await catalog.catalog("acp.plan.finish", {
            ...key,
            expectedStatus: "claimed",
            status: "unknown",
            taskId: run.taskId,
            error: "ACP execution outcome is pending",
          })
        : null;
    run = owned ?? (await catalog.catalog("acp.plan.readRun", key));
    if (run?.status !== "unknown" || !run.definition) return run;
    const definition = run.definition,
      project = definition.projectId,
      submissionKey = acpPlanSubmissionKey(scheduleId, runId);
    const input: SubmitTaskRequest = {
      type: "acp-prompt",
      engine: definition.engine,
      initialConfig: definition.values,
      input: definition.prompt,
    };
    const fingerprint = fingerprintPayload(input);
    const finish = async (
      status: "started" | "failed" | "unknown",
      taskId: string | null,
      error: string | null,
    ) => {
      const updated = await catalog.catalog("acp.plan.finish", {
        ...key,
        expectedStatus: "unknown",
        status,
        taskId,
        error: error?.slice(0, 2048) ?? null,
      });
      return updated ?? catalog.catalog("acp.plan.readRun", key);
    };
    const applyCompletion = async (intent: AcpPlanCompletion) => {
      try {
        if (definition.prompt.attachments.length && !resources)
          throw Error("ACP resource cleanup is unavailable");
        await resources?.releaseOwner(intent.projectId, submissionKey);
      } catch (error) {
        return finish("unknown", intent.taskId, `ACP resource cleanup pending: ${String(error)}`);
      }
      return finish(intent.status, intent.taskId, intent.error);
    };
    const completeKnown = async (
      status: "started" | "failed",
      taskId: string | null,
      error: string | null,
    ) => {
      const intent = await catalog.catalog("acp.plan.completion.put", {
        ...key,
        projectId: project,
        status,
        taskId,
        error: error?.slice(0, 2048) ?? null,
      });
      if (!intent) throw Error("ACP plan completion identity conflict");
      return applyCompletion(intent);
    };
    // 完成意图优先于当前目录、认证、附件和提交账本；恢复只重试资源清理。
    const pendingCompletion = await catalog.catalog("acp.plan.completion.read", key);
    if (pendingCompletion) return applyCompletion(pendingCompletion);
    const persist = async (record: TaskSubmissionRecord) => {
      if (submissions.writeAcpSubmission)
        await submissions.writeAcpSubmission(project, submissionKey, record, {
          engine: definition.engine,
          workspacePath: null,
        });
      else await submissions.writeSubmission(project, submissionKey, record);
    };
    let previous: TaskSubmissionRecord | undefined;
    try {
      previous = await submissions.readSubmission(project, submissionKey);
    } catch (error) {
      return owned ? finish("unknown", run.taskId, String(error)) : run;
    }
    if (previous && previous.fingerprint !== fingerprint)
      return owned ? finish("unknown", run.taskId, "ACP submission identity conflict") : run;
    // 已知启动先于目录、认证和当前计划校验恢复；无需重新创建会话或再次发送。
    if (previous?.result) {
      if (previous.stage !== "completed") await persist({ ...previous, stage: "completed" });
      return completeKnown("started", previous.result.taskId, null);
    }
    if (!owned || previous?.stage === "creating" || previous?.stage === "starting") {
      // 退出时可能尚未来得及投影任务 ID；只恢复账本中的引用，不启动新的提交。
      if (!run.taskId && previous?.task)
        return finish("unknown", previous.task.id, run.error ?? "ACP execution outcome is pending");
      return run;
    }
    let context: Awaited<ReturnType<ProjectContextResolver>>;
    let prepared: Awaited<ReturnType<typeof resolveInput>> | undefined;
    let prompt = definition.prompt;
    let created = previous?.task;
    let confirmed: TaskSubmissionRecord | undefined;
    let outcome: {
      status: "started" | "failed" | "unknown";
      taskId: string | null;
      error: string | null;
    };
    try {
      const result = await submitTask(submissions, project, submissionKey, fingerprint, input, {
        validate: async () => {
          if (!submissions.claimSubmission)
            throw new Error("ACP execution requires durable submission claims");
          if (
            (!definition.prompt.text.trim() && !definition.prompt.attachments.length) ||
            (definition.prompt.attachments.length && !resources) ||
            definition.prompt.skills.length
          )
            throw new Error("Persistent ACP plan resources are not ready");
          context = await getProjectContext(project);
          if (
            !context?.provider.startConfiguredTurn ||
            (await context.provider.getCapabilities()).runtime !== "acp"
          )
            throw new Error("ACP project runtime is unavailable");
          if (definition.prompt.attachments.length && resources) {
            const restored = await resources.restore(
              { source: "web", scheduleId, definition, revision: run.definitionRevision },
              undefined,
              submissionKey,
            );
            prompt = restored.prompt;
          }
        },
        createTask: async () => {
          if (!context) throw new Error("ACP project runtime is unavailable");
          created = await context.provider.startTask({ engine: definition.engine });
          return created;
        },
        prepare: async (taskId) => {
          if (!context) throw new Error("ACP project runtime is unavailable");
          prepared = await resolveInput(project, prompt, context.provider, taskId);
          if (
            prepared.attachmentIds.length !== prompt.attachments.length ||
            prompt.attachments.some((ref, i) => ref.id !== prepared?.attachmentIds[i])
          )
            throw new Error("Unexpected ACP plan attachments");
          return prepared.attachmentIds;
        },
        execute: async (taskId) => {
          if (!context?.provider.startConfiguredTurn || !prepared)
            throw new Error("ACP input is unavailable");
          const checkpoint = context.eventStream.checkpoint;
          const turn = await context.provider.startConfiguredTurn(
            taskId,
            prepared.providerInput,
            definition.values,
          );
          const result = { taskId, turn, checkpoint, ...(created ? { createdTask: created } : {}) };
          confirmed = {
            fingerprint,
            stage: "completed",
            result,
            attachmentIds: prepared.attachmentIds,
            ...(created ? { task: created } : {}),
          };
          return result;
        },
        complete: () => Promise.resolve(),
      });
      outcome = { status: "started", taskId: result.taskId, error: null };
    } catch (error) {
      // RPC 已确认后先补写提交账本；补写仍失败则交由独立完成意图保存已知结果。
      if (confirmed) {
        try {
          await persist(confirmed);
          outcome = { status: "started", taskId: confirmed.result?.taskId ?? null, error: null };
        } catch {
          // RPC 已明确返回；提交账本故障时仍交由独立完成意图保存确认结果，不能丢失 ACK。
          outcome = {
            status: "started",
            taskId: confirmed.result?.taskId ?? null,
            error: null,
          };
        }
      } else {
        try {
          const record = await submissions.readSubmission(project, submissionKey);
          const uncertain = record?.stage === "creating" || record?.stage === "starting";
          outcome = {
            status: uncertain ? "unknown" : "failed",
            taskId: record?.task?.id ?? created?.id ?? run.taskId,
            error: error instanceof Error ? error.message : String(error),
          };
        } catch {
          outcome = {
            status: "unknown",
            taskId: created?.id ?? run.taskId,
            error: "ACP submission outcome could not be read",
          };
        }
      }
    }
    // 没有资源端口的调用不会恢复附件，明确失败时无需回收本轮缓存。
    if (outcome.status === "failed" && !resources)
      return finish(outcome.status, outcome.taskId, outcome.error);
    return outcome.status === "unknown"
      ? finish(outcome.status, outcome.taskId, outcome.error)
      : completeKnown(outcome.status, outcome.taskId, outcome.error);
  };
}
