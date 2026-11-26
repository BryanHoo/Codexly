import { Type, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { AcpAgentServices } from "@codexly/core";
import {
  AcpScheduledConfigViewSchema,
  SetAcpScheduledConfigSchema,
  type AcpScheduledConfigView,
  type SetAcpScheduledConfig,
} from "@codexly/protocol";
import type { FastifyPluginCallback, FastifySchema, FastifySchemaCompiler } from "fastify";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import { ScheduledTaskServiceError } from "../scheduled-task-service.js";

const params = Type.Object(
  { taskId: Type.String({ minLength: 1, maxLength: 256 }) },
  { additionalProperties: false },
);
const validatorCompiler: FastifySchemaCompiler<FastifySchema> =
  ({ schema }) =>
  (value) =>
    Value.Check(schema as TSchema, value)
      ? { value }
      : { error: new Error("Invalid ACP configuration request") };
function conflict(): never {
  throw new MutationHttpError(
    "IDEMPOTENCY_CONFLICT",
    "Scheduled task configuration changed; reload before saving",
    409,
  );
}
function mapError(error: unknown): never {
  if (error instanceof ScheduledTaskServiceError)
    throw new MutationHttpError(
      error.code === "not_found" ? "TASK_NOT_FOUND" : "INVALID_REQUEST",
      error.message,
      error.code === "not_found" ? 404 : error.code === "busy" ? 409 : 400,
    );
  throw error;
}
function same(
  values: Record<string, string | boolean>,
  other: Record<string, string | boolean>,
): boolean {
  return (
    Object.keys(values).length === Object.keys(other).length &&
    Object.entries(values).every(([id, value]) => Object.hasOwn(other, id) && other[id] === value)
  );
}

export const registerScheduledAcpConfigRoutes: FastifyPluginCallback<{
  context: ServerRouteContext;
  agents: AcpAgentServices | undefined;
}> = (app, { context, agents }, done) => {
  const store = () => {
    if (context.capabilities.runtime !== "acp" || !context.localCatalogStore)
      throw new MutationHttpError(
        "PROVIDER_ERROR",
        "ACP scheduled configuration is unavailable",
        503,
      );
    return context.localCatalogStore;
  };
  const read = async (
    id: string,
    projectId: string,
    canEdit: boolean,
  ): Promise<AcpScheduledConfigView> => {
    const config = await store().catalog("acp.schedule.read", { source: "web", scheduleId: id });
    return {
      projectId,
      canEdit,
      config: config
        ? { engine: config.engine, values: config.values, revision: config.revision }
        : null,
    };
  };
  const save = async (id: string, input: SetAcpScheduledConfig, signal: AbortSignal) => {
    if (input.expectedRevision === 0 && !input.confirmMigration)
      throw new MutationHttpError(
        "INVALID_REQUEST",
        "Confirm the ACP settings before migrating this plan",
        400,
      );
    if (Buffer.byteLength(JSON.stringify(input.values)) > 262144)
      throw new MutationHttpError(
        "INVALID_REQUEST",
        "ACP scheduled configuration exceeds capacity",
        400,
      );
    const inspect = async (projectId: string, canEdit: boolean) => {
      if (input.projectId !== projectId) conflict();
      const view = await read(id, projectId, canEdit);
      if (
        view.config &&
        view.config.engine === input.engine &&
        same(view.config.values, input.values)
      )
        return { view, complete: true };
      if ((view.config?.revision ?? 0) !== input.expectedRevision) conflict();
      if (!canEdit)
        throw new ScheduledTaskServiceError("busy", "Previous launch requires reconciliation");
      return { view, complete: false };
    };
    const initial = await context.scheduledTaskService.withTaskState(id, (task, canEdit) =>
      inspect(task.projectId, canEdit),
    );
    if (initial.complete) return initial.view;
    const agent = agents?.[input.engine];
    if (!agent?.previewConfig)
      throw new MutationHttpError(
        "PROVIDER_ERROR",
        "ACP configuration preview is unavailable",
        503,
      );
    const project = await context.getProjectContext(input.projectId);
    if (!project) throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
    // 预览会创建临时会话，不能持有调度互斥；实际目录只从授权项目上下文读取。
    const checked = await agent.previewConfig(
      project.scope.rootPath,
      { values: input.values },
      signal,
    );
    if (
      !Object.entries(input.values).every(([id, value]) =>
        checked.configOptions.some((option) => option.id === id && option.currentValue === value),
      )
    )
      throw new MutationHttpError(
        "INVALID_REQUEST",
        "ACP agent did not accept the selected configuration",
        400,
      );
    return context.scheduledTaskService.withTaskState(id, async (task, canEdit) => {
      const current = await inspect(task.projectId, canEdit);
      if (current.complete) return current.view;
      const result = await store().catalog("acp.schedule.set", {
        source: "web",
        scheduleId: id,
        engine: input.engine,
        values: input.values,
        expectedRevision: input.expectedRevision,
      });
      if (!result) conflict();
      return {
        projectId: task.projectId,
        canEdit: true,
        config: { engine: result.engine, values: result.values, revision: result.revision },
      };
    });
  };
  app.get<{ Params: { taskId: string } }>(
    "/v1/scheduled-tasks/:taskId/acp-config",
    { validatorCompiler, schema: { params, response: { 200: AcpScheduledConfigViewSchema } } },
    async (request) => {
      try {
        return await context.scheduledTaskService.withTaskState(
          request.params.taskId,
          (task, canEdit) => read(task.id, task.projectId, canEdit),
        );
      } catch (error) {
        mapError(error);
      }
    },
  );
  app.put<{
    Params: { taskId: string };
    Body: SetAcpScheduledConfig;
    Headers: { "idempotency-key": string };
  }>(
    "/v1/scheduled-tasks/:taskId/acp-config",
    {
      validatorCompiler,
      schema: {
        params,
        body: SetAcpScheduledConfigSchema,
        headers: Type.Object({ "idempotency-key": Type.String({ minLength: 1 }) }),
        response: { 200: AcpScheduledConfigViewSchema },
      },
    },
    (request) =>
      context.runIdempotent(
        ["scheduled-acp-config", request.params.taskId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          try {
            return await save(request.params.taskId, request.body, request.signal);
          } catch (error) {
            mapError(error);
          }
        },
      ),
  );
  done();
};
