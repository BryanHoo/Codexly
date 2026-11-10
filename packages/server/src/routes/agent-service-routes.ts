import type { FastifyInstance } from "fastify";
import type { AcpAgentServices } from "@codexly/core";
import type { ServerRouteContext } from "./context.js";
import { registerEngineRoutes } from "./engine-routes.js";
import { registerAcpRoutes } from "./acp-routes.js";

/** 迁移期间集中装配 agent 服务；生产切换后在这里移除旧引擎设置入口。 */
export async function registerAgentServiceRoutes(
  app: FastifyInstance,
  context: ServerRouteContext,
  agents: AcpAgentServices | undefined,
) {
  await app.register(registerEngineRoutes, context);
  await app.register(registerAcpRoutes, { context, agents: agents ?? context.provider.acpAgents });
}
