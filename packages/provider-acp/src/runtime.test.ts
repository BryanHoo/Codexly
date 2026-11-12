import type { AnyMessage } from "@agentclientprotocol/sdk/unstable";
import { it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateApplicationText,
  applicationPreferencesFromLegacy,
  type CatalogOperations,
  type LocalCatalogStore,
  type LocalTask,
} from "@codexly/core";
import type { AgentTurnOptions } from "@codexly/protocol";
import { AcpRuntime, type AcpAgentLauncher } from "./runtime.js";
it("订阅和任务目录不启动 agent，实际执行只延迟装配对应引擎；释放后拒绝旧引用", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-runtime-"));
  const tasks = new Map<string, LocalTask>();
  const store: LocalCatalogStore = {
    catalog: <K extends keyof CatalogOperations>(
      operation: K,
      payload: CatalogOperations[K][0],
    ) => {
      const task = payload as LocalTask;
      if (operation === "task.put") {
        tasks.set(task.id, task);
        return Promise.resolve(task as CatalogOperations[K][1]);
      }
      if (operation === "task.read")
        return Promise.resolve((tasks.get(task.id) ?? null) as CatalogOperations[K][1]);
      return Promise.reject(new Error(operation));
    },
  };
  const launch = vi.fn<AcpAgentLauncher>(() => Promise.reject(new Error("模拟离线")));
  const runtime = new AcpRuntime(root, store, launch);
  try {
    const router = runtime.forTemporary(root);
    expect(runtime.forTemporary(root)).toBe(router);
    const unsubscribe = router.subscribeEvents(() => undefined);
    const task = await router.startTask({ engine: "claude" });
    expect(launch).not.toHaveBeenCalled();
    await expect(
      router.startTurn(
        task.id,
        { text: "问题", files: [], images: [], skills: [], textAttachments: [] },
        {} as AgentTurnOptions,
      ),
    ).rejects.toThrow("模拟离线");
    expect(launch).toHaveBeenCalledOnce();
    expect(launch.mock.calls[0]?.[0]).toBe("claude");
    unsubscribe();
    await runtime.releaseProject("temporary", router);
    expect(runtime.forTemporary(root)).not.toBe(router);
    await expect(router.startTask({ engine: "codex" })).rejects.toThrow("关闭");
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});

it.each(["title", "commit", "optimize"] as const)(
  "运行时 %s 辅助生成经 ACP 返回正文、拒绝工具权限并释放辅助会话",
  async (purpose) => {
    const acp = await import("@agentclientprotocol/sdk/unstable");
    const { AcpConnection } = await import("./connection.js");
    const root = await mkdtemp(join(tmpdir(), "acp-generation-"));
    const catalog = vi.fn(() => Promise.reject(new Error("不应访问目录")));
    const closed = vi.fn(() => ({}));
    const launch: AcpAgentLauncher = async (_engine, _scope, callbacks) => {
      const a = new TransformStream<AnyMessage, AnyMessage>();
      const b = new TransformStream<AnyMessage, AnyMessage>();
      const peer = acp
        .agent({ name: "test" })
        .onRequest(acp.methods.agent.initialize, () => ({
          protocolVersion: 1,
          agentCapabilities: { sessionCapabilities: { close: {} } },
        }))
        .onRequest(acp.methods.agent.session.new, () => ({ sessionId: "helper" }))
        .onRequest(acp.methods.agent.session.close, closed)
        .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
          const permission = await client.request(acp.methods.client.session.requestPermission, {
            sessionId: params.sessionId,
            options: [{ optionId: "allow", name: "允许", kind: "allow_once" }],
            toolCall: { toolCallId: "helper-tool", title: "执行命令" },
          });
          expect(permission.outcome.outcome).toBe("cancelled");
          await client.notify(acp.methods.client.session.update, {
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: {
                type: "text",
                text: JSON.stringify(
                  purpose === "title" ? { title: "辅助回答" } : { message: "辅助回答" },
                ),
              },
            },
          });
          return { stopReason: "end_turn" };
        })
        .connect({ readable: a.readable, writable: b.writable });
      const connection = await AcpConnection.connect(
        { readable: b.readable, writable: a.writable },
        callbacks,
      );
      return {
        connection,
        close: () => {
          connection.close();
          peer.close();
          return Promise.resolve();
        },
      };
    };
    const runtime = new AcpRuntime(root, { catalog }, launch);
    try {
      expect(
        await generateApplicationText(
          applicationPreferencesFromLegacy({ defaultAgent: "claude", defaultModel: null }),
          root,
          { purpose, text: "输入" },
          new AbortController().signal,
          runtime.generateText.bind(runtime),
        ),
      ).toBe("辅助回答");
      expect(catalog).not.toHaveBeenCalled();
      expect(closed).toHaveBeenCalledOnce();
    } finally {
      await runtime.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
