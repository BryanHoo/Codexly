import { testPrompt, type Reason } from "./acp-v2-peer.test-support.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, vi } from "vitest";
import * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable";
import type { LocalTask, LocalCatalogStore, CatalogOperations } from "@codexly/core";
import type { AgentEngine, AcpConfigOption } from "@codexly/protocol";
import { AcpConnection } from "./connection.js";
import { AcpHistory } from "./history.js";
import { AcpAgentProvider } from "./provider.js";
import { AcpSessionInitialization } from "./session-initialization.js";
import { AcpSettingsStore } from "./settings-store.js";
import { AcpStorageLeases } from "./storage-lease.js";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
export async function fixture(
  engine: AgentEngine,
  handler?: (
    context: acp.AgentRequestContext<acp.PromptRequest>,
  ) => Promise<{ stopReason: Reason }>,
  initializeSession?: (
    connection: AcpConnection,
    sessionId: string,
    options: AcpConfigOption[],
  ) => Promise<AcpConfigOption[]>,
  management?: {
    capabilities?: acp.InitializeResponse["capabilities"];
    steering?: boolean;
    persistConfiguration?: boolean;
    deleteSession?: (sessionId: string) => Record<string, never> | Promise<Record<string, never>>;
  },
) {
  const directory = await mkdtemp(join(tmpdir(), "acp-provider-"));
  const tasks = new Map<string, LocalTask>();
  const catalog = vi.fn((op: string, input: LocalTask) => {
    // 测试目录按顺序执行，存储锁用于覆盖真实初始化文件的读写路径。
    if (op === "acp.storage.read") return null;
    if (op === "acp.storage.claim" || op === "acp.storage.release") return true;
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
    async ({ params, client }: acp.AgentRequestContext<acp.ResumeSessionRequest>) => {
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
  const resumed = vi.fn((_context: acp.AgentRequestContext<acp.ResumeSessionRequest>) => ({}));
  const closed = vi.fn<() => acp.CloseSessionResponse>(() => ({}));
  const connected = vi.fn<() => void>();
  const app = acp
    .agent({ name: "test" })
    .onRequest(acp.methods.agent.initialize, () => ({
      protocolVersion: 2,
      info: management?.steering
        ? { name: "@agentclientprotocol/codex-acp", version: "2.8.0" }
        : { name: "test-agent", version: "1" },
      capabilities: management?.capabilities ?? {
        session: {},
      },
      ...(management?.steering ? { _meta: { steering: { supported: true } } } : {}),
    }))
    .onRequest(acp.methods.agent.session.new, created)
    .onRequest(acp.methods.agent.session.close, closed)
    .onRequest(acp.methods.agent.session.delete, ({ params }) => {
      if (!management?.deleteSession) throw new Error("未配置测试删除处理器");
      return management.deleteSession(params.sessionId);
    })
    .onRequest(acp.methods.agent.session.resume, async (context) => {
      const result = context.params.replayFrom ? await loaded(context) : resumed(context);
      if (context.params.replayFrom)
        await context.client.notify(acp.methods.client.session.update, {
          sessionId: context.params.sessionId,
          update: { sessionUpdate: "replay_complete" },
        });
      await context.client.notify(acp.methods.client.session.update, {
        sessionId: context.params.sessionId,
        update: { sessionUpdate: "state_update", state: "idle" },
      });
      return result;
    })
    .onRequest(
      acp.methods.agent.session.prompt,
      testPrompt(async (context) => {
        if (handler) return handler(context);
        const { params, client } = context;
        await client.notify(acp.methods.client.session.update, {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            messageId: "test-message",
            content: { type: "text", text: "ACP 回答" },
          },
        });
        return { stopReason: "end_turn" };
      }),
    );
  const history = new AcpHistory(directory);
  const createProvider = () =>
    new AcpAgentProvider(
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
        connected();
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
      management?.persistConfiguration
        ? new AcpSessionInitialization(
            join(directory, "session-initialization"),
            new AcpSettingsStore(join(directory, "settings")),
            new AcpStorageLeases({
              catalog: (operation, payload) =>
                Promise.resolve(catalog(operation, payload as unknown as LocalTask) as never),
            }),
          )
        : undefined,
    );
  const provider = createProvider();
  let restarted: AcpAgentProvider | undefined;
  const restart = async () => {
    await provider.close();
    restarted = createProvider();
    return restarted;
  };
  cleanup.push(async () => {
    await restarted?.close();
    await provider.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    provider,
    restart,
    tasks,
    created,
    loaded,
    resumed,
    closed,
    connected,
    history,
    catalog,
    app,
  };
}
export const input = { text: "问题", files: [], images: [], skills: [], textAttachments: [] };
