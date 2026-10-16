import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { expect, it } from "vitest";
import { claudeEnvironment } from "./config.js";

// 真正启动官方 SDK 配套二进制；只替换远端 API，不使用真实密钥或消耗额度。
it("runs the official Claude runtime against an isolated local Messages API", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-sdk-contract-"));
  const requests: { path: string; key: string | undefined }[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
      requests.push({
        path: request.url ?? "",
        key: request.headers["x-api-key"] as string | undefined,
      });
      if (request.url?.includes("count_tokens")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ input_tokens: 10 }));
        return;
      }
      if (!request.url?.includes("/messages")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end("{}");
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { stream?: boolean };
      const message = {
        id: "msg_contract",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "local-contract-ok" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      if (!body.stream) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(message));
        return;
      }
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const event of [
        { type: "message_start", message: { ...message, content: [], stop_reason: null } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "local-contract-ok" },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 5 },
        },
        { type: "message_stop" },
      ])
        response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      response.end();
    })().catch(() => {
      response.destroy();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test API address");
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, 25_000);
  const stream = query({
    prompt: "Reply with local-contract-ok",
    options: {
      cwd: root,
      env: {
        ...claudeEnvironment({
          apiKey: "isolated-test-key",
          baseUrl: `http://127.0.0.1:${String(address.port)}`,
        }),
        CLAUDE_CONFIG_DIR: join(root, "runtime"),
      },
      abortController: controller,
      model: "claude-sonnet-4-6",
      settingSources: [],
      tools: [],
      persistSession: true,
      settings: { apiKeyHelper: "", forceLoginMethod: "console" },
      includePartialMessages: true,
    },
  });
  try {
    const messages: unknown[] = [];
    for await (const message of stream) messages.push(message);
    expect(messages).toContainEqual(
      expect.objectContaining({ type: "result", subtype: "success", result: "local-contract-ok" }),
    );
    expect(requests.filter((request) => request.path.includes("/messages"))).toContainEqual(
      expect.objectContaining({ key: "isolated-test-key" }),
    );
  } finally {
    clearTimeout(timer);
    stream.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
    await rm(root, { recursive: true, force: true });
  }
}, 35_000);
