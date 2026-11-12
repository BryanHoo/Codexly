import type { FastifyInstance } from "fastify";
import type { AcpAgentServices } from "@codexly/core";
import type { ServerRouteContext } from "./routes/context.js";
import { AcpPlanScheduler } from "./acp-plan-scheduler.js";
import { AcpPlanService } from "./acp-plan-service.js";
import { AcpPlanResourceManager } from "./acp-plan-resource-transfer.js";
import { createAcpPlanExecutor } from "./acp-plan-executor.js";
import { registerAcpPlanRoutes } from "./routes/acp-plan-routes.js";
import { registerResourceChangeEvents } from "./routes/resource-change-events.js";
import { AcpPlanChanges } from "./acp-plan-events.js";

/** 入口和执行器同批装配；缺少持久提交端口时不开放可启用的新计划。 */
export async function registerAcpPlanRuntime(
  app: FastifyInstance,
  context: ServerRouteContext,
  agents: AcpAgentServices | undefined,
) {
  const catalog = context.localCatalogStore;
  if (
    context.capabilities.runtime !== "acp" ||
    !catalog ||
    !context.submissionRepository.claimSubmission ||
    !context.submissionRepository.writeAcpSubmission
  )
    return;
  const resources = new AcpPlanResourceManager(catalog, context.attachmentStore);
  const changes = new AcpPlanChanges();
  const execute = createAcpPlanExecutor({
    catalog,
    submissions: context.submissionRepository,
    getProjectContext: context.getProjectContext,
    resolveInput: context.resolveProviderTurnInput,
    resources,
  });
  const scheduler = new AcpPlanScheduler({ catalog, execute: changes.observe(catalog, execute) });
  const service = new AcpPlanService({
    catalog,
    getProjectContext: context.getProjectContext,
    agents: agents ?? context.provider.acpAgents ?? {},
    resources,
    wake: () => {
      scheduler.wake();
      changes.publish();
    },
  });
  // 路由和配对权限均就绪后才扫描；关闭先等待调度，随后全局 onClose 释放项目 / agent / 存储。
  app.addHook("onReady", (done) => {
    scheduler.start();
    done();
  });
  app.addHook("preClose", () => scheduler.close());
  registerResourceChangeEvents(
    app,
    context,
    "/v1/acp/plans/events",
    { type: "acp-plans.changed" },
    (listener) =>
      changes.subscribe(() => {
        listener({ type: "acp-plans.changed" });
      }),
  );
  await app.register(registerAcpPlanRoutes, {
    catalog,
    service,
    runIdempotent: context.runIdempotent,
  });
}
