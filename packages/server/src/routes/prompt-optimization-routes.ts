import { readGenerationDefaults } from "@codexly/core";
import {
  OptimizePromptRequestSchema,
  OptimizePromptResponseSchema,
  AgentMutationErrorSchema,
  buildPromptOptimizationInput,
  PROMPT_OPTIMIZATION_SYSTEM,
  type OptimizePromptRequest,
} from "@codexly/protocol";
import type { FastifyPluginCallback } from "fastify";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import { IdempotencyHeadersSchema, ProjectParamsSchema } from "./schemas.js";

export const registerPromptOptimizationRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  context,
  done,
) => {
  app.post<{
    Params: { projectId: string };
    Body: OptimizePromptRequest;
    Headers: { "idempotency-key": string };
  }>(
    "/v1/projects/:projectId/prompt-optimization",
    {
      schema: {
        params: ProjectParamsSchema,
        headers: IdempotencyHeadersSchema,
        body: OptimizePromptRequestSchema,
        response: {
          200: OptimizePromptResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    async (request) => {
      const project = await context.getProjectContext(request.params.projectId);
      if (!project) throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
      return context.runIdempotent(
        ["optimize-prompt", request.params.projectId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const stored = await context.settingsRepository.readGlobalSettings();
          const defaults = await readGenerationDefaults(context.provider, stored);
          const prompt = buildPromptOptimizationInput(
            request.body.text,
            stored?.promptOptimizationPrompt,
          );
          // 复用无工具临时生成的结构化正文协议及超时清理，不创建可见聊天记录。
          let text: string;
          if (defaults.defaultAgent === "claude") {
            const service = context.provider.engines?.claude;
            if (!service?.generateCommitMessage)
              throw new MutationHttpError("PROVIDER_ERROR", "Claude engine is unavailable", 503);
            text = await service.generateCommitMessage(
              prompt,
              defaults.defaultModel,
              PROMPT_OPTIMIZATION_SYSTEM,
            );
          } else {
            text = await context.generateCommitMessageWithCodex(
              project.provider,
              `${PROMPT_OPTIMIZATION_SYSTEM}\n\n${prompt}`,
              {
                model: defaults.defaultModel,
                reasoningEffort: "",
                approvalPolicy: "never",
                approvalsReviewer: "user",
                sandboxMode: "read-only",
              },
            );
          }
          text = text.trim();
          if (!text || text.length > 10_000)
            throw new MutationHttpError("PROVIDER_ERROR", "Invalid optimized prompt", 502);
          return { text };
        },
      );
    },
  );
  done();
};
