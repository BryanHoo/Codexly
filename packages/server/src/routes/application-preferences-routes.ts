import { Value } from "@sinclair/typebox/value";
import { Type } from "@sinclair/typebox";
import type { TSchema } from "@sinclair/typebox";
import type { FastifyPluginCallback } from "fastify";
import { ApplicationPreferencesService } from "@codexly/core";
import {
  AgentInstructionsTargetsSchema,
  SaveAgentInstructionsSchema,
  ApplicationPreferencesSchema,
  ApplicationPreferencesPatchSchema,
  type ApplicationPreferencesPatch,
} from "@codexly/protocol/application-preferences";
import { MutationHttpError, type ServerRouteContext } from "./context.js";

/** 独立本地偏好端口沿用全局配对认证；不调用旧全局设置聚合器或模型目录。 */
export const registerApplicationPreferencesRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  context,
  done,
) => {
  if (!context.localCatalogStore) {
    done();
    return;
  }
  const service = new ApplicationPreferencesService(context.localCatalogStore, () =>
    context.settingsRepository.readGlobalSettings(),
  );
  app.addHook("onRequest", (_request, reply, next) => {
    reply.header("cache-control", "no-store");
    next();
  });
  app.get(
    "/v1/application-preferences",
    { schema: { response: { 200: ApplicationPreferencesSchema } } },
    () => service.read(),
  );
  app.patch<{ Body: ApplicationPreferencesPatch; Headers: { "idempotency-key": string } }>(
    "/v1/application-preferences",
    {
      bodyLimit: 262144,
      // AJV 的移除额外字段 / 类型转换不能把非法补丁悄悄改成合法请求。
      validatorCompiler:
        ({ schema }) =>
        (input: unknown) =>
          Value.Check(schema as TSchema, input)
            ? { value: input }
            : { error: new Error("Invalid application preferences patch") },
      schema: {
        body: ApplicationPreferencesPatchSchema,
        headers: Type.Object({ "idempotency-key": Type.String({ minLength: 1, maxLength: 256 }) }),
        response: { 200: ApplicationPreferencesSchema },
      },
    },
    (request) =>
      context.runIdempotent(
        ["application-preferences"],
        request.headers["idempotency-key"],
        request.body,
        () => service.patch(request.body),
      ),
  );
  const { provider } = context;
  const confirmInstructions = provider.saveAgentInstructions?.bind(provider);
  if (provider.getAgentInstructionsTargets && confirmInstructions) {
    app.get(
      "/v1/application-preferences/instructions/targets",
      { schema: { response: { 200: AgentInstructionsTargetsSchema } } },
      () => provider.getAgentInstructionsTargets?.(),
    );
    app.post(
      "/v1/application-preferences/instructions",
      {
        bodyLimit: 524288,
        schema: {
          headers: Type.Object({
            "idempotency-key": Type.String({ minLength: 1, maxLength: 256 }),
          }),
          response: { 200: ApplicationPreferencesSchema },
        },
      },
      (request) => {
        if (!Value.Check(SaveAgentInstructionsSchema, request.body))
          throw new MutationHttpError("INVALID_REQUEST", "Invalid global instructions", 400);
        const input = request.body;
        const key = request.headers["idempotency-key"];
        if (typeof key !== "string")
          throw new MutationHttpError("INVALID_REQUEST", "Missing idempotency key", 400);
        return context.runIdempotent(["application-instructions"], key, input, () =>
          confirmInstructions(input),
        );
      },
    );
  }
  done();
};
