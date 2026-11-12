import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, vi } from "vitest";
import * as acp from "@agentclientprotocol/sdk/unstable";
import type { LocalTask, LocalCatalogStore, CatalogOperations } from "@codexly/core";
import { AcpConnection } from "./connection.js";
import { AcpHistory } from "./history.js";
import { AcpAgentProvider } from "./provider.js";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
export async function fixture(
  engine: "codex" | "claude",
  handler?: (context: acp.AgentRequestContext<acp.PromptRequest>) => Promise<acp.PromptResponse>,
  initializeSession?: (
    connection: AcpConnection,
    sessionId: string,
    options: acp.SessionConfigOption[],
  ) => Promise<acp.SessionConfigOption[]>,
  management?: {
    capabilities?: acp.InitializeResponse["agentCapabilities"];
    deleteSession?: (sessionId: string) => Record<string, never> | Promise<Record<string, never>>;
  },
) {
  const directory = await mkdtemp(join(tmpdir(), "acp-provider-"));
  const tasks = new Map<string, LocalTask>();
  const catalog = vi.fn((op: string, input: LocalTask) => {
    if (op === "task.read") return tasks.get(input.id) ?? null;
    if (op === "task.remove") return tasks.delete(input.id);
    if (op === "task.put") {
      tasks.set(input.id, input);
      return input;
    }
    if (op === "task.patch") {
      const old = tasks.get(input.id);
      if (!old) throw new Error("不存在");
      const next = { ...old, ...input };
      tasks.set(input.id, next);
      return next;
    }
    throw new Error(op);
  });
  const created = vi.fn<
    (
      context: acp.AgentRequestContext<acp.NewSessionRequest>,
    ) => acp.NewSessionResponse | Promise<acp.NewSessionResponse>
  >(() => ({
    sessionId: "native",
    configOptions: [],
  }));
  const loaded = vi.fn(
    async ({ params, client }: acp.AgentRequestContext<acp.LoadSessionRequest>) => {
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "user_message_chunk",
          messageId: "old-user",
          content: { type: "text", text: "旧问题" },
        },
      });
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "old-reply",
          content: { type: "text", text: "旧回答" },
        },
      });
      return {};
    },
  );
  const app = acp
    .agent({ name: "test" })
    .onRequest(acp.methods.agent.initialize, () => ({
      protocolVersion: 1,
      agentCapabilities: management?.capabilities ?? {
        loadSession: true,
        sessionCapabilities: { close: {} },
      },
    }))
    .onRequest(acp.methods.agent.session.new, created)
    .onRequest(acp.methods.agent.session.close, () => ({}))
    .onRequest(acp.methods.agent.session.delete, ({ params }) => {
      if (!management?.deleteSession) throw new Error("未配置测试删除处理器");
      return management.deleteSession(params.sessionId);
    })
    .onRequest(acp.methods.agent.session.load, loaded)
    .onRequest(acp.methods.agent.session.prompt, async (context) => {
      if (handler) return handler(context);
      const { params, client } = context;
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "ACP 回答" },
        },
      });
      return { stopReason: "end_turn" };
    });
  const history = new AcpHistory(directory);
  const provider = new AcpAgentProvider(
    engine,
    { id: "project", kind: "project", rootPath: directory, runtimeWorkspaceRoots: [directory] },
    {
      catalog: <K extends keyof CatalogOperations>(
        operation: K,
        payload: CatalogOperations[K][0],
      ) =>
        Promise.resolve(
          catalog(operation, payload as unknown as LocalTask) as CatalogOperations[K][1],
        ),
    } satisfies LocalCatalogStore,
    history,
    async (callbacks) => {
      const a = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
      const b = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
      const agent = app.connect({ readable: a.readable, writable: b.writable });
      cleanup.push(() => {
        agent.close();
        return Promise.resolve();
      });
      return AcpConnection.connect({ readable: b.readable, writable: a.writable }, callbacks);
    },
    initializeSession,
  );
  cleanup.push(async () => {
    await provider.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { provider, tasks, created, loaded, history, catalog, app };
}
export const input = { text: "问题", files: [], images: [], skills: [], textAttachments: [] };
