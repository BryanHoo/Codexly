import * as acp from "@agentclientprotocol/sdk/unstable";
import { expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AcpConnection } from "./connection.js";
import type { AcpAgentLauncher } from "./runtime.js";
import type { AgentRuntimeProvider } from "@codexly/core";
import { AcpApplicationRuntime } from "./application-runtime.js";

it("全局端口消费 ACP 模型与默认配置，辅助生成只连接偏好引擎", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-app-"));
  const launch = vi.fn<AcpAgentLauncher>(async (_engine, _scope, callbacks) => {
    const a = new TransformStream<acp.AnyMessage, acp.AnyMessage>(),
      b = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
    const options: acp.SessionConfigOption[] = [
      {
        id: "model",
        name: "模型",
        type: "select",
        category: "model",
        currentValue: "model-a",
        options: [{ value: "model-a", name: "模型 A" }],
      },
    ];
    const peer = acp
      .agent({ name: "global" })
      .onRequest(acp.methods.agent.initialize, () => ({
        protocolVersion: 1,
        agentCapabilities: { sessionCapabilities: { close: {} } },
      }))
      .onRequest(acp.methods.agent.session.new, () => ({
        sessionId: "helper",
        configOptions: options,
      }))
      .onRequest(acp.methods.agent.session.close, () => ({}))
      .onRequest(acp.methods.agent.session.setConfigOption, () => ({ configOptions: options }))
      .onRequest(acp.methods.agent.session.prompt, async ({ client, params }) => {
        await client.notify(acp.methods.client.session.update, {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: '{"title":"修复登录"}' },
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
  });
  const catalog = vi.fn(() => Promise.reject(new Error("辅助生成不访问任务目录")));
  const runtime = new AcpApplicationRuntime(
    root,
    { catalog },
    () => Promise.resolve({ defaultAgent: "claude", defaultModel: "model-a" }),
    launch,
  );
  const port: AgentRuntimeProvider = runtime;
  try {
    expect((await port.getCapabilities()).skills.use).toBe(false);
    await expect(port.readProviderConnection()).rejects.toThrow("ACP");
    expect(launch).not.toHaveBeenCalled();
    expect(
      await port.readGenerationDefaults?.({ defaultAgent: "claude", defaultModel: "model-a" }),
    ).toEqual({ defaultAgent: "claude", defaultModel: "model-a" });
    expect(launch).not.toHaveBeenCalled();
    expect(
      await runtime.generateTaskTitle(root, "修复登录", "model-a", new AbortController().signal),
    ).toBe("修复登录");
    expect(launch.mock.calls.every(([engine]) => engine === "claude")).toBe(true);
    expect(catalog).not.toHaveBeenCalled();
    expect((await runtime.listModels("claude")).data[0]?.id).toBe("model-a");
    expect(await runtime.readDefaultSettings()).toEqual({ model: "model-a" });
    await runtime.updateDefaultSettings({ model: "model-a" });
    expect((await runtime.settings.read("codex")).values).toEqual({ model: "model-a" });
    await expect(runtime.updateDefaultSettings({ sandboxMode: "workspace-write" })).rejects.toThrow(
      "映射",
    );
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});
