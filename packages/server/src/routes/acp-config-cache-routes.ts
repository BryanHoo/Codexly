import {
  AcpConfigCacheSchema,
  AcpSettingsSnapshotResponseSchema,
  AgentEngineSchema,
  type AgentEngine,
} from "@codexly/protocol";
import type { AcpAgentServices } from "@codexly/core";
import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";
import { withGenerationCancellation } from "./generation-cancellation.js";

export function registerAcpConfigCacheRoutes(
  app: FastifyInstance,
  startup: AcpAgentServices["startupConfig"],
) {
  const path = "/v1/acp/agents/:engine/config-cache";
  const schema = {
    params: Type.Object({ engine: AgentEngineSchema }, { additionalProperties: false }),
    response: { 200: AcpConfigCacheSchema },
  };
  app.get<{ Params: { engine: AgentEngine } }>(
    path,
    { schema },
    (request) => startup?.read(request.params.engine) ?? Promise.resolve(null),
  );
  app.post<{ Params: { engine: AgentEngine } }>(path, { schema }, (request, reply) =>
    withGenerationCancellation(
      request,
      reply,
      async (signal) => {
        const engine = request.params.engine;
        // 探测错误沿用上一次成功的可展示快照，实际聊天走独立的发送错误处理。
        return startup?.refresh(engine, signal).catch(() => startup.read(engine)) ?? null;
      },
      "ACP startup configuration refresh timed out",
    ),
  );
  const snapshotPath = "/v1/acp/agents/:engine/settings-snapshot";
  const snapshotSchema = {
    params: schema.params,
    response: { 200: AcpSettingsSnapshotResponseSchema },
  };
  app.get<{ Params: { engine: AgentEngine } }>(
    snapshotPath,
    { schema: snapshotSchema },
    (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return startup?.settings?.read(request.params.engine) ?? null;
    },
  );
  app.post<{ Params: { engine: AgentEngine } }>(
    snapshotPath,
    { schema: snapshotSchema, handlerTimeout: 42_000 },
    (request, reply) =>
      withGenerationCancellation(request, reply, async (signal) => {
        reply.header("Cache-Control", "no-store");
        return startup?.settings?.refresh(request.params.engine, signal) ?? null;
      }),
  );
}
