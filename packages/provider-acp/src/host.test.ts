import { storageCatalog } from "./storage-catalog.test-support.js";
import { Writable } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { LocalTask, AgentProviderEvent } from "@codexly/core";
import { AcpHost } from "./host.js";
import * as acp from "@agentclientprotocol/sdk/unstable";
import { AcpConnection } from "./connection.js";
import type { AcpAgentLauncher } from "./runtime.js";

it("共享宿主以目录反向请求管理双引擎身份，正确接收拆分 UTF-8 帧并拒绝跨项目读取", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-host-"));
  const tasks = new Map<string, LocalTask>();
  const replies: Record<string, unknown>[] = [];
  let permission: acp.RequestPermissionResponse | undefined;
  const prompts: acp.ContentBlock[][] = [];
  const closeSession = vi.fn(() => ({}));
  const launch = vi.fn<AcpAgentLauncher>(() => Promise.reject(new Error("目录操作不启动 agent")));
  const storage = storageCatalog();
  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      const message = JSON.parse(chunk.toString()) as Record<string, unknown>;
      if (typeof message["catalogId"] === "number") {
        const operation = message["operation"],
          task = message["payload"] as LocalTask;
        const result =
          storage(operation, message["payload"]) ??
          (operation === "task.put"
            ? task
            : operation === "task.patch"
              ? { ...tasks.get(task.id), ...task }
              : (tasks.get(task.id) ?? null));
        if (operation === "task.put") tasks.set(task.id, task);
        if (operation === "task.patch") tasks.set(task.id, { ...tasks.get(task.id), ...task });
        queueMicrotask(() => {
          host.receive(
            Buffer.from(`${JSON.stringify({ catalogId: message["catalogId"], result })}\n`),
          );
        });
      } else replies.push(message);
      callback();
    },
  });
  const host = new AcpHost(root, output, launch);
  const scope = { id: "项目", kind: "project", rootPath: root, runtimeWorkspaceRoots: [root] };
  try {
    const frame = Buffer.from(
      `${JSON.stringify({ id: 1, method: "task.start", scope, params: { engine: "claude" } })}\n`,
    );
    for (const byte of frame) host.receive(Buffer.from([byte]));
    await vi.waitFor(() => {
      expect(replies.some((reply) => reply["id"] === 1)).toBe(true);
    });
    const task = [...tasks.values()][0];
    if (!task) throw new Error("未创建目录任务");
    expect(task.provider).toBe("claude");
    expect(task.projectId).toBe("项目");
    expect(launch).not.toHaveBeenCalled();
    host.receive(
      Buffer.from(
        `${JSON.stringify({ id: 2, method: "task.read", scope: { ...scope, id: "other" }, params: { taskId: task.id } })}\n`,
      ),
    );
    await vi.waitFor(() => {
      expect(replies.find((reply) => reply["id"] === 2)).toMatchObject({
        error: "ACP_HOST_REQUEST_FAILED",
      });
    });
    expect(launch).not.toHaveBeenCalled();
    host.receive(
      Buffer.from(
        `${JSON.stringify({ id: 8, method: "task.retain", scope, params: { taskId: task.id, leaseId: "view" } })}\n`,
      ),
    );
    await vi.waitFor(() => {
      expect(replies.find((reply) => reply["id"] === 8)).toMatchObject({ result: null });
    });
    expect(launch).not.toHaveBeenCalled();
    launch.mockImplementation(async (_engine, _scope, callbacks) => {
      const a = new TransformStream<acp.AnyMessage, acp.AnyMessage>(),
        b = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
      const peer = acp
        .agent({ name: "host-test" })
        .onRequest(acp.methods.agent.initialize, () => ({
          protocolVersion: 1,
          agentCapabilities: _engine === "claude" ? { sessionCapabilities: { close: {} } } : {},
        }))
        .onRequest(acp.methods.agent.session.new, () => ({
          sessionId: "native",
          configOptions: [
            {
              id: "model",
              name: "模型",
              category: "model",
              type: "select" as const,
              currentValue: "a",
              options: [{ value: "a", name: "A" }],
            },
            {
              id: "effort",
              name: "思考",
              category: "thought_level",
              type: "select" as const,
              currentValue: "low",
              options: [{ value: "low", name: "低" }],
            },
          ],
        }))
        .onRequest(acp.methods.agent.session.setConfigOption, () => ({ configOptions: [] }))
        .onRequest(acp.methods.agent.session.close, closeSession)
        .onRequest(acp.methods.agent.session.prompt, async ({ client, params }) => {
          prompts.push(params.prompt);
          await client.notify(acp.methods.client.session.update, {
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "宿主流式回答" },
            },
          });
          if (prompts.length > 1) return { stopReason: "end_turn" };
          permission = await client.request(acp.methods.client.session.requestPermission, {
            sessionId: params.sessionId,
            toolCall: { toolCallId: "write", title: "写入文件" },
            options: [
              { optionId: "once", kind: "allow_once", name: "允许一次" },
              { optionId: "always", kind: "allow_always", name: "始终允许" },
            ],
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
    host.receive(
      Buffer.from(
        `${JSON.stringify({ id: 3, method: "prompt.start", scope, params: { taskId: task.id, input: { text: "问题", files: [], images: [], skills: [], textAttachments: [] } } })}\n`,
      ),
    );
    const pending = await vi.waitFor(() => {
      const event = replies
        .map((reply) => reply["event"] as AgentProviderEvent | undefined)
        .find((event) => event?.type === "pending_request.created");
      if (event?.type !== "pending_request.created") throw new Error("等待审批");
      return event.payload.request;
    });
    host.receive(
      Buffer.from(
        `${JSON.stringify({ id: 7, method: "queue.add", scope, params: { taskId: task.id, clientUserMessageId: "queued-message", input: { text: "排队问题", files: [], images: [], skills: [], textAttachments: [] } } })}\n`,
      ),
    );
    await vi.waitFor(() => {
      expect(replies.find((reply) => reply["id"] === 7)).toMatchObject({
        result: { queue: { data: [{ text: "排队问题" }] } },
      });
    });
    expect(prompts).toHaveLength(1);
    // 有排队输入和待审批回合时关闭视图，不能丢失终态、队列接续或持久历史。
    host.receive(
      Buffer.from(
        `${JSON.stringify({ id: 9, method: "task.release", scope, params: { taskId: task.id, leaseId: "view" } })}\n`,
      ),
    );
    await vi.waitFor(() => {
      expect(replies.find((reply) => reply["id"] === 9)).toMatchObject({ result: null });
    });
    const resolution = {
      requestId: pending.requestId,
      taskId: pending.taskId,
      projectId: pending.projectId,
      turnId: pending.turnId,
      itemId: pending.itemId,
      type: pending.type,
      resolution: { decision: "allow", optionId: "always" },
    };
    host.receive(
      Buffer.from(
        `${JSON.stringify({ id: 4, method: "request.resolve", scope, params: { ...resolution, itemId: "other" } })}\n`,
      ),
    );
    await vi.waitFor(() => {
      expect(replies.find((reply) => reply["id"] === 4)).toMatchObject({
        error: "ACP_HOST_REQUEST_FAILED",
      });
    });
    expect(permission).toBeUndefined();
    host.receive(
      Buffer.from(
        `${JSON.stringify({ id: 5, method: "request.resolve", scope, params: resolution })}\n`,
      ),
    );
    await vi.waitFor(() => {
      expect(
        replies.filter(
          (reply) => (reply["event"] as AgentProviderEvent | undefined)?.type === "turn.completed",
        ),
      ).toHaveLength(2);
    });
    expect(prompts[1]).toContainEqual({ type: "text", text: "排队问题" });
    expect(replies.some((reply) => JSON.stringify(reply).includes("宿主流式回答"))).toBe(true);
    expect(launch.mock.calls[0]?.[0]).toBe("claude");
    expect(permission).toEqual({ outcome: { outcome: "selected", optionId: "always" } });
    host.receive(
      Buffer.from(
        `${JSON.stringify({ id: 6, method: "task.read", scope, params: { taskId: task.id } })}\n`,
      ),
    );
    await vi.waitFor(() => {
      expect(replies.find((reply) => reply["id"] === 6)).toMatchObject({
        snapshotProjectId: scope.id,
        result: { id: task.id },
      });
    });
    expect(replies.filter((reply) => reply["id"] === 6)).toHaveLength(1);
    const snapshot = replies.find((reply) => reply["id"] === 6)?.["result"] as { turns: unknown[] };
    expect(snapshot.turns).toHaveLength(2);
    await vi.waitFor(() => {
      expect(closeSession).toHaveBeenCalledOnce();
    });
  } finally {
    await host.close();
    output.destroy();
    await rm(root, { recursive: true, force: true });
  }
});

it("无效帧触发关闭，未知方法不执行任意运行时成员", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-host-invalid-"));
  const replies: string[] = [];
  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      replies.push(chunk.toString());
      callback();
    },
  });
  const launch = vi.fn(() => Promise.reject(new Error("禁止启动")));
  const host = new AcpHost(root, output, launch);
  try {
    host.receive(Buffer.from('{"id":1,"method":"close","params":{}}\n'));
    await vi.waitFor(() => {
      expect(replies.join("")).toContain("ACP_HOST_REQUEST_FAILED");
    });
    expect(host.closed).toBe(false);
    host.receive(Buffer.from("{broken}\n"));
    expect(host.closed).toBe(true);
    expect(launch).not.toHaveBeenCalled();
  } finally {
    await host.close();
    output.destroy();
    await rm(root, { recursive: true, force: true });
  }
});
