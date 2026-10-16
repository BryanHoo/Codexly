import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const resources = fileURLToPath(new URL("../desktop/src-tauri/resources/claude/", import.meta.url));
const suffix = process.platform === "win32" ? ".exe" : "";

// 覆盖实际分发的独立宿主和官方执行文件，不要求用户安装 Node/Bun 或登录官方账号。
test(
  "standalone host persists settings, approves tools and resumes the exact SDK session after restart",
  { timeout: 45_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "codexly-host-"));
    const tasks = new Map();
    let calls = 0;
    const api = createServer((request, response) => {
      void (async () => {
        let raw = "";
        for await (const chunk of request) raw += chunk;
        if (request.url.includes("count_tokens")) {
          response.setHeader("content-type", "application/json");
          response.end('{"input_tokens":10}');
          return;
        }
        if (!request.url.includes("/messages")) {
          response.setHeader("content-type", "application/json");
          response.end("{}");
          return;
        }
        assert.equal(request.headers["x-api-key"], "local-host-test");
        const body = JSON.parse(raw);
        calls++;
        const useTool = calls === 1;
        const content = useTool
          ? [
              {
                type: "tool_use",
                id: "write-proof",
                name: "Write",
                input: { file_path: join(directory, "proof.txt"), content: "approved" },
              },
            ]
          : [{ type: "text", text: "host-contract-ok" }];
        const message = {
          id: `msg-${calls}`,
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-6",
          content,
          stop_reason: useTool ? "tool_use" : "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        };
        if (!body.stream) {
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify(message));
          return;
        }
        response.setHeader("content-type", "text/event-stream");
        const events = [
          { type: "message_start", message: { ...message, content: [], stop_reason: null } },
        ];
        for (const [index, block] of content.entries()) {
          const initial =
            block.type === "tool_use" ? { ...block, input: {} } : { ...block, text: "" };
          const delta =
            block.type === "tool_use"
              ? { type: "input_json_delta", partial_json: JSON.stringify(block.input) }
              : { type: "text_delta", text: block.text };
          events.push(
            { type: "content_block_start", index, content_block: initial },
            { type: "content_block_delta", index, delta },
            { type: "content_block_stop", index },
          );
        }
        events.push(
          {
            type: "message_delta",
            delta: { stop_reason: message.stop_reason, stop_sequence: null },
            usage: { output_tokens: 5 },
          },
          { type: "message_stop" },
        );
        for (const event of events)
          response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        response.end();
      })().catch((error) => {
        response.destroy(error);
      });
    });
    await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
    const scope = {
      id: "p",
      kind: "project",
      rootPath: directory,
      runtimeWorkspaceRoots: [directory],
    };
    tasks.set("task", {
      id: "task",
      projectId: "p",
      provider: "claude",
      sessionId: null,
      cwd: directory,
      title: "",
      updatedAt: 1,
      pinned: false,
      archived: false,
      status: "notLoaded",
    });
    const launch = () => {
      const child = spawn(
        join(resources, `claude-host${suffix}`),
        [directory, join(resources, `claude${suffix}`)],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      const responses = new Map(),
        events = [];
      let next = 0,
        stderr = "";
      child.stderr.on("data", (data) => {
        stderr = `${stderr}${data}`.slice(-4000);
      });
      const send = (message) => {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      };
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        const message = JSON.parse(line);
        if (message.catalogId) {
          const { operation, payload } = message;
          let result;
          if (operation === "task.read") result = tasks.get(payload.id) ?? null;
          else if (operation === "task.patch") {
            result = { ...tasks.get(payload.id), ...payload };
            tasks.set(payload.id, result);
          } else throw new Error(`Unexpected catalog operation ${operation}`);
          send({ catalogId: message.catalogId, result });
        } else if (message.id) {
          const deferred = responses.get(message.id);
          responses.delete(message.id);
          if (message.error) deferred?.reject(new Error(message.error));
          else deferred?.resolve(message.result);
        } else if (message.event) events.push(message.event);
      });
      const exited = new Promise((resolve) => child.once("exit", resolve));
      return {
        events,
        request(method, params = {}, taskScope) {
          const id = ++next;
          const deferred = Promise.withResolvers();
          responses.set(id, deferred);
          send({ id, method, params, scope: taskScope });
          return Promise.race([
            deferred.promise,
            new Promise((_, reject) => {
              const timer = setTimeout(
                () => reject(new Error(`Host timeout: ${method}: ${stderr}`)),
                20_000,
              );
              timer.unref();
            }),
          ]);
        },
        async close() {
          child.stdin.end();
          const timer = setTimeout(() => child.kill(), 3000);
          await exited;
          clearTimeout(timer);
          lines.close();
        },
      };
    };
    let host = launch();
    const waitEvent = async (type, after = 0) => {
      for (let i = 0; i < 400; i++) {
        const event = host.events.slice(after).find((event) => event.type === type);
        if (event) return event;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(
        `Missing host event: ${type}: ${JSON.stringify(host.events.map((event) => ({ type: event.type, payload: event.payload })))}`,
      );
    };
    try {
      const settings = await host.request("settings.read");
      assert.equal(settings.permissionMode, "default");
      await host.request("settings.write", {
        ...settings,
        instructions: "Always test",
        loadProjectSettings: false,
      });
      await host.request("configure", {
        apiKey: "local-host-test",
        baseUrl: `http://127.0.0.1:${api.address().port}`,
        models: [{ id: "claude-sonnet-4-6", name: "Test" }],
      });
      const profile = await host.request("profile");
      assert.equal(JSON.stringify(profile).includes("local-host-test"), false);
      assert.deepEqual(profile.configuredModels, [{ id: "claude-sonnet-4-6", name: "Test" }]);
      const options = {
        model: "claude-sonnet-4-6",
        reasoningEffort: "",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandboxMode: "workspace-write",
        engineOptions: { engine: "claude", permissionMode: "default" },
      };
      const input = {
        text: "Write proof then reply",
        images: [],
        files: [],
        textAttachments: [],
        skills: [],
      };
      await host.request("turn.start", { taskId: "task", input, options }, scope);
      const pending = (await waitEvent("pending_request.created")).payload.request;
      assert.equal(pending.type, "tool_approval");
      await host.request(
        "request.resolve",
        { ...pending, resolution: { decision: "allow" } },
        scope,
      );
      assert.equal((await waitEvent("turn.completed")).payload.turn.status, "completed");
      assert.equal(await readFile(join(directory, "proof.txt"), "utf8"), "approved");
      const sessionId = tasks.get("task").sessionId;
      assert.ok(sessionId);
      await host.close();
      host = launch();
      assert.equal((await host.request("settings.read")).instructions, "Always test");
      assert.equal((await host.request("task.read", { taskId: "task" }, scope)).turns.length, 1);
      await host.request(
        "turn.start",
        { taskId: "task", input: { ...input, text: "Continue" }, options },
        scope,
      );
      assert.equal((await waitEvent("turn.completed")).payload.turn.status, "completed");
      assert.equal(tasks.get("task").sessionId, sessionId);
      assert.equal((await host.request("task.read", { taskId: "task" }, scope)).turns.length, 2);
      await host.request("configure", {
        baseUrl: `http://127.0.0.1:${api.address().port}`,
        models: [],
      });
      assert.deepEqual((await host.request("profile")).configuredModels, []);
      await host.request("disconnect");
      assert.equal((await host.request("profile")).connection.state, "disconnected");
      assert.equal((await host.request("settings.read")).instructions, "Always test");
      assert.equal((await host.request("task.read", { taskId: "task" }, scope)).turns.length, 2);
    } finally {
      await host.close();
      api.closeAllConnections();
      await new Promise((resolve) => api.close(resolve));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
