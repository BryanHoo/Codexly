import { createServer, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentProviderEvent,
  CatalogOperations,
  LocalCatalogStore,
  LocalTask,
} from "@codexly/core";
import { expect, it, vi } from "vitest";
import { ClaudeConfiguration, claudeEnvironment } from "./config.js";
import { ClaudeAgentProvider, type ClaudeSdk } from "./provider.js";

// 模型响应由本地服务控制；Agent 派发、后台通知和主代理续跑均由官方运行时真实执行。
function reply(
  response: ServerResponse,
  content: (
    { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: object }
  )[],
  stream: boolean,
  id: number,
) {
  const tool = content.some((block) => "type" in block && block.type === "tool_use");
  const message = {
    id: `msg_${String(id)}`,
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    content,
    stop_reason: tool ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
  if (!stream) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(message));
    return;
  }
  response.writeHead(200, { "content-type": "text/event-stream" });
  const send = (event: Record<string, unknown> & { type: string }) => {
    response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };
  send({ type: "message_start", message: { ...message, content: [], stop_reason: null } });
  for (const [index, block] of content.entries()) {
    send({
      type: "content_block_start",
      index,
      content_block: block.type === "tool_use" ? { ...block, input: {} } : { ...block, text: "" },
    });
    send({
      type: "content_block_delta",
      index,
      delta:
        block.type === "tool_use"
          ? { type: "input_json_delta", partial_json: JSON.stringify(block.input) }
          : { type: "text_delta", text: block.text },
    });
    send({ type: "content_block_stop", index });
  }
  send({
    type: "message_delta",
    delta: { stop_reason: message.stop_reason, stop_sequence: null },
    usage: { output_tokens: 5 },
  });
  send({ type: "message_stop" });
  response.end();
}

it.each(["completed", "failed"] as const)(
  "automatically delivers a real %s background subagent to its parent without another user send",
  async (outcome) => {
    const root = await mkdtemp(join(tmpdir(), "claude-native-subagent-"));
    const parentWaiting = Promise.withResolvers<undefined>();
    const events: AgentProviderEvent[] = [];
    const native: SDKMessage[] = [];
    let userSends = 0;
    const errors: unknown[] = [];
    let childCalls = 0;
    let calls = 0,
      parentCalls = 0,
      notificationReceived = false;
    const server = createServer((request, response) => {
      void (async () => {
        let raw = "";
        for await (const chunk of request) raw += String(chunk);
        if (!request.url?.includes("/messages")) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ input_tokens: 10 }));
          return;
        }
        expect(request.headers["x-api-key"]).toBe("isolated-test-key");
        const body = JSON.parse(raw) as { system?: unknown; messages: unknown[]; stream: boolean };
        const id = ++calls;
        if (JSON.stringify(body.system).includes("native-worker-marker")) {
          // 先让父代理真实结束一次回复，再允许子代理返回，稳定覆盖异步通知路径。
          await parentWaiting.promise;
          if (outcome === "failed") {
            response.writeHead(400, { "content-type": "application/json" });
            response.end(
              JSON.stringify({
                type: "error",
                error: { type: "invalid_request_error", message: "native-child-error" },
              }),
            );
          } else {
            childCalls++;
            reply(
              response,
              childCalls === 1
                ? [
                    {
                      type: "tool_use",
                      id: "child-write",
                      name: "Write",
                      input: {
                        file_path: join(root, "child-proof.txt"),
                        content: "child-proof-42",
                      },
                    },
                  ]
                : [{ type: "text", text: "child-proof-42" }],
              body.stream,
              id,
            );
          }
        } else {
          parentCalls++;
          const transcript = JSON.stringify(body.messages);
          notificationReceived ||=
            transcript.includes("<task-notification>") &&
            transcript.includes(outcome === "completed" ? "child-proof-42" : "native-child-error");
          reply(
            response,
            parentCalls === 1
              ? [
                  {
                    type: "tool_use",
                    id: "spawn-native",
                    name: "Agent",
                    input: {
                      description: "native background proof",
                      subagent_type: "worker",
                      prompt: "Return the proof",
                      run_in_background: true,
                    },
                  },
                ]
              : [
                  {
                    type: "text",
                    text: notificationReceived ? "parent-summary-42" : "parent-waiting",
                  },
                ],
            body.stream,
            id,
          );
        }
      })().catch((error: unknown) => {
        errors.push(error);
        response.destroy();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing API address");
    const tasks = new Map<string, LocalTask>();
    const store = {
      catalog(operation: keyof CatalogOperations, payload: unknown) {
        const value = payload as LocalTask;
        if (operation === "task.read") return Promise.resolve(tasks.get(value.id) ?? null);
        if (operation === "task.put" || operation === "task.patch") {
          const task = { ...tasks.get(value.id), ...value };
          tasks.set(value.id, task);
          return Promise.resolve(task);
        }
        throw new Error(`Unexpected catalog operation: ${operation}`);
      },
    } as LocalCatalogStore;
    const sdk: ClaudeSdk = {
      getSessionMessages: () => Promise.resolve([]),
      deleteSession: vi.fn(() => Promise.resolve()),
      query: vi.fn<ClaudeSdk["query"]>((input) => {
        const stream = query({
          prompt: (async function* () {
            for await (const message of input.prompt) {
              userSends++;
              yield message;
            }
          })(),
          options: {
            ...input.options,
            env: {
              ...claudeEnvironment(
                {
                  apiKey: "isolated-test-key",
                  baseUrl: `http://127.0.0.1:${String(address.port)}`,
                },
                Object.fromEntries(
                  Object.entries(process.env).filter(
                    ([key]) => !/^(ANTHROPIC_|CLAUDE_|CLAUDECODE$)/u.test(key),
                  ),
                ),
              ),
              CLAUDE_CONFIG_DIR: join(root, "native"),
            },
            settingSources: [],
            settings: { apiKeyHelper: "", forceLoginMethod: "console" },
            tools: ["Agent", "Write"],
            agents: {
              worker: {
                description: "Test worker",
                prompt: "native-worker-marker",
                tools: ["Write"],
              },
            },
          },
        });
        const iterate = stream[Symbol.asyncIterator].bind(stream);
        stream[Symbol.asyncIterator] = async function* () {
          for await (const message of { [Symbol.asyncIterator]: iterate }) {
            native.push(message);
            if (
              message.type === "assistant" &&
              !message.parent_tool_use_id &&
              JSON.stringify(message.message.content).includes("parent-waiting")
            )
              parentWaiting.resolve(undefined);
            yield message;
          }
        };
        return stream;
      }),
    };
    const config = new ClaudeConfiguration(root, join(root, "settings"));
    const scope = {
      id: "p",
      kind: "project" as const,
      rootPath: root,
      runtimeWorkspaceRoots: [root],
    };
    // SDK 自动续跑有独立调度窗口；并发测试下不能依赖历史写盘耗时撑过 100ms 回收期限。
    const provider = new ClaudeAgentProvider(scope, store, config, sdk, undefined, 1_000);
    provider.subscribeEvents((event) => {
      events.push(event);
      // 模拟用户批准临时目录内的写入，保留真实 canUseTool 请求与回复通道。
      if (
        event.type === "pending_request.created" &&
        event.payload.request.type === "tool_approval"
      )
        void provider
          .resolvePendingRequest({ ...event.payload.request, resolution: { decision: "allow" } })
          .catch((error: unknown) => {
            errors.push(error);
          });
    });
    const task = await provider.startTask();
    try {
      await provider.startTurn(
        task.id,
        {
          text: "Delegate to worker then summarize",
          files: [],
          images: [],
          skills: [],
          textAttachments: [],
        },
        {
          model: "claude-sonnet-4-6",
          reasoningEffort: "",
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          sandboxMode: "workspace-write",
          engineOptions: { engine: "claude", permissionMode: "default" },
        },
      );
      await vi.waitFor(
        async () => {
          expect(errors).toEqual([]);
          const snapshot = await provider.readTask(task.id);
          expect(snapshot?.turns.flatMap((turn) => turn.items)).toContainEqual(
            expect.objectContaining({
              type: "message",
              role: "assistant",
              text: "parent-summary-42",
            }),
          );
        },
        { timeout: 20_000 },
      );
      expect(notificationReceived).toBe(true);
      expect(sdk.query).toHaveBeenCalledOnce();
      expect(userSends).toBe(1);
      expect(parentCalls).toBe(3);
      if (outcome === "completed") {
        expect(await readFile(join(root, "child-proof.txt"), "utf8")).toBe("child-proof-42");
        expect(
          events.some(
            (event) =>
              event.type === "pending_request.created" &&
              event.payload.request.type === "tool_approval" &&
              event.payload.request.toolName === "Write",
          ),
        ).toBe(true);
      }
      expect(native).toContainEqual(
        expect.objectContaining({
          type: "system",
          subtype: "task_notification",
          status: outcome,
        }),
      );
      await vi.waitFor(
        () => {
          expect(provider.isBusy).toBe(false);
        },
        { timeout: 5_000 },
      );
      const restored = new ClaudeAgentProvider(scope, store, config, sdk);
      const snapshot = await restored.readTask(task.id);
      expect(
        snapshot?.turns
          .flatMap((turn) => turn.items)
          .filter((item) => item.type === "message" && item.role === "user"),
      ).toHaveLength(1);
      expect(snapshot?.turns.flatMap((turn) => turn.items)).toContainEqual(
        expect.objectContaining({ name: "agent/spawn", status: outcome }),
      );
      expect(snapshot?.turns.flatMap((turn) => turn.items)).toContainEqual(
        expect.objectContaining({ role: "assistant", text: "parent-summary-42" }),
      );
      expect(new Set(native.map((message) => message.session_id)).size).toBe(1);
      restored.close();
    } finally {
      parentWaiting.resolve(undefined);
      await provider.stopSession(task.id);
      provider.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
      await rm(root, { recursive: true, force: true });
    }
  },
  35_000,
);
