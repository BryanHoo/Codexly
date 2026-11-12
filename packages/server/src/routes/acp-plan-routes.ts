import { Type, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { FastifyPluginCallback, FastifySchema, FastifySchemaCompiler } from "fastify";
import type { LocalCatalogStore } from "@codexly/core";
import {
  AcpPlanPageSchema,
  AcpPlanViewSchema,
  AcpPlanResourceSchema,
  SaveAcpPlanSchema,
  ListAcpPlansSchema,
  DeleteAcpPlanSchema,
  DeleteAcpPlanResponseSchema,
  StageAcpPlanResourceSchema,
  type SaveAcpPlan,
  type ListAcpPlans,
  type StageAcpPlanResource,
} from "@codexly/protocol/acp-plan-api";
import { AcpPlanServiceError, type AcpPlanService } from "../acp-plan-service.js";
import { MutationHttpError, type RunIdempotent } from "./context.js";
// 原始配置键的正则在默认序列化器生成 JSON Pointer 时会丢失转义；这里先严格校验，避免改写 agent 键。
const serializerCompiler =
  ({ schema }: { schema: unknown }) =>
  (data: unknown) => {
    if (!Value.Check(schema as TSchema, data)) throw new Error("Invalid ACP plan response");
    return JSON.stringify(data);
  };
export interface AcpPlanRoutePorts {
  service: Pick<AcpPlanService, "read" | "save" | "delete" | "stage">;
  catalog: LocalCatalogStore;
  runIdempotent: RunIdempotent;
}
const Params = Type.Object(
  { id: Type.String({ minLength: 1, maxLength: 256 }) },
  { additionalProperties: false },
);
const Headers = Type.Object({ "idempotency-key": Type.String({ minLength: 1, maxLength: 256 }) });
const validatorCompiler: FastifySchemaCompiler<FastifySchema> =
  ({ schema, httpPart }) =>
  (input: unknown) => {
    let value = input;
    // 只把 URL 中规范的整数 limit 转成数字；正文配置仍严格保留 string / boolean 原值。
    if (
      httpPart === "querystring" &&
      typeof input === "object" &&
      input !== null &&
      "limit" in input &&
      typeof input.limit === "string" &&
      /^(?:[1-9]|[1-9][0-9]|100)$/u.test(input.limit)
    )
      value = { ...input, limit: Number(input.limit) };
    return Value.Check(schema as TSchema, value)
      ? { value }
      : { error: new Error("Invalid ACP plan request") };
  };
function mapError(error: unknown): never {
  if (error instanceof AcpPlanServiceError)
    throw new MutationHttpError(
      error.code === "conflict"
        ? "IDEMPOTENCY_CONFLICT"
        : error.code === "unavailable"
          ? "PROVIDER_ERROR"
          : "INVALID_REQUEST",
      error.message,
      error.code === "conflict" || error.code === "busy"
        ? 409
        : error.code === "unavailable"
          ? 503
          : 400,
    );
  throw error;
}
/** 由生产装配器提供配对认证及运行生命周期；本插件不启动调度器或猜测默认配置。 */
export const registerAcpPlanRoutes: FastifyPluginCallback<AcpPlanRoutePorts> = (
  app,
  { service, catalog, runIdempotent },
  done,
) => {
  app.addHook("onRequest", (_request, reply, next) => {
    reply.header("cache-control", "no-store");
    next();
  });
  const action = async <T>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (error) {
      return mapError(error);
    }
  };
  const mutate = <T>(kind: string, id: string, key: string, input: unknown, fn: () => Promise<T>) =>
    runIdempotent(["acp-plan", kind, id], key, input, () => action(fn));
  app.get<{ Querystring: ListAcpPlans }>(
    "/v1/acp/plans",
    {
      validatorCompiler,
      serializerCompiler,
      schema: { querystring: ListAcpPlansSchema, response: { 200: AcpPlanPageSchema } },
    },
    (request) =>
      catalog.catalog("acp.plan.list", {
        source: "web",
        limit: request.query.limit ?? 20,
        ...(request.query.after === undefined ? {} : { after: request.query.after }),
      }),
  );
  app.get<{ Params: { id: string } }>(
    "/v1/acp/plans/:id",
    {
      validatorCompiler,
      serializerCompiler,
      schema: { params: Params, response: { 200: AcpPlanViewSchema } },
    },
    async (request) => {
      const view = await service.read(request.params.id);
      if (!view) throw new MutationHttpError("TASK_NOT_FOUND", "ACP plan not found", 404);
      return view;
    },
  );
  app.put<{ Params: { id: string }; Body: SaveAcpPlan; Headers: { "idempotency-key": string } }>(
    "/v1/acp/plans/:id",
    {
      validatorCompiler,
      serializerCompiler,
      handlerTimeout: 150_000,
      schema: {
        params: Params,
        body: SaveAcpPlanSchema,
        headers: Headers,
        response: { 200: AcpPlanViewSchema },
      },
    },
    (request) =>
      mutate("save", request.params.id, request.headers["idempotency-key"], request.body, () =>
        service.save(request.params.id, request.body, request.signal),
      ),
  );
  app.delete<{
    Params: { id: string };
    Body: { expectedRevision: number };
    Headers: { "idempotency-key": string };
  }>(
    "/v1/acp/plans/:id",
    {
      validatorCompiler,
      serializerCompiler,
      schema: {
        params: Params,
        body: DeleteAcpPlanSchema,
        headers: Headers,
        response: { 200: DeleteAcpPlanResponseSchema },
      },
    },
    (request) =>
      mutate(
        "delete",
        request.params.id,
        request.headers["idempotency-key"],
        request.body,
        async () => {
          if (!(await service.delete(request.params.id, request.body.expectedRevision)))
            throw new MutationHttpError(
              "IDEMPOTENCY_CONFLICT",
              "ACP plan changed or has an unresolved launch",
              409,
            );
          return { deleted: true };
        },
      ),
  );
  app.post<{
    Params: { id: string };
    Body: StageAcpPlanResource;
    Headers: { "idempotency-key": string };
  }>(
    "/v1/acp/plans/:id/resources",
    {
      validatorCompiler,
      serializerCompiler,
      schema: {
        params: Params,
        body: StageAcpPlanResourceSchema,
        headers: Headers,
        response: { 200: AcpPlanResourceSchema },
      },
    },
    (request) =>
      mutate("stage", request.params.id, request.headers["idempotency-key"], request.body, () =>
        service.stage(
          request.params.id,
          request.body.projectId,
          request.body.uploadId,
          request.signal,
        ),
      ),
  );
  done();
};
