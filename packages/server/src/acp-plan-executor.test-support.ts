import { vi } from "vitest";
import type { AcpScheduledPlanDefinition } from "@codexly/protocol/acp-scheduled-plan";
import type { AgentProvider } from "@codexly/core";
import definition from "../../../tests/fixtures/acp-scheduled-plan-definition.json" with { type: "json" };
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";
import { createProvider, project, turnOptions } from "./app-all.test-support.js";
import { AgentEventStream } from "./agent-event-stream.js";
import { createAcpPlanExecutor } from "./acp-plan-executor.js";
export async function fixture(patch: Partial<AcpScheduledPlanDefinition> = {}) {
  const root = await createWorkspace();
  const store = await openRepository(root);
  const h = createProvider();
  const capabilities = await h.provider.getCapabilities();
  vi.spyOn(h.provider, "getCapabilities").mockResolvedValue({ ...capabilities, runtime: "acp" });
  const start = h.startTurn.getMockImplementation();
  if (!start) throw Error("Missing turn fixture");
  const configured = vi.fn<NonNullable<AgentProvider["startConfiguredTurn"]>>((id, input) =>
    start(id, input, turnOptions),
  );
  h.provider.startConfiguredTurn = configured;
  const key = { source: "web" as const, scheduleId: "plan" };
  await store.catalog("acp.plan.set", {
    ...key,
    definition: {
      ...(definition as AcpScheduledPlanDefinition),
      projectId: project.id,
      enabled: true,
      ...patch,
    },
    expectedRevision: 0,
  });
  await store.catalog("acp.plan.arm", {
    ...key,
    expectedRevision: 1,
    expectedStateRevision: 0,
    nextRunAt: 10,
  });
  await store.catalog("acp.plan.claim", {
    ...key,
    expectedRevision: 1,
    expectedStateRevision: 1,
    runId: "run",
    now: 10,
    nextRunAt: null,
  });
  const getProjectContext = vi.fn(() =>
    Promise.resolve({
      provider: h.provider,
      scope: {
        id: project.id,
        kind: "project" as const,
        rootPath: "/test",
        runtimeWorkspaceRoots: [],
      },
      eventStream: new AgentEventStream({ provider: "acp", sessionId: "test" }),
      transportMetrics: { activeClients: 0, slowClientDisconnects: 0 },
      unsubscribe() {
        /* 测试没有注册事件订阅。 */
      },
    }),
  );
  const resolveInput = vi.fn((_p: string, input: { text: string }) =>
    Promise.resolve({
      attachmentIds: [],
      providerInput: { text: input.text, files: [], images: [], skills: [], textAttachments: [] },
    }),
  );
  const run = createAcpPlanExecutor({
    catalog: store,
    submissions: store,
    getProjectContext,
    resolveInput,
  });
  return { root, store, h, key, configured, getProjectContext, resolveInput, run };
}
