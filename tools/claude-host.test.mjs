import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
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
    let titleCalls = 0;
    const messageBodies = [];
    const proofContent = `approved${"x".repeat(400000)}`;
    const api = createServer((request, response) => {
      void (async () => {
        let raw = "";
        for await (const chunk of request) raw += chunk;
        // 真实宿主必须在认证拒绝后切换到 Bearer，并且只保存检测成功的凭据。
        if (request.url.startsWith("/v1/models")) {
          response.setHeader("content-type", "application/json");
          if (request.headers.authorization !== "Bearer detected-token") {
            response.writeHead(401);
            response.end("{}");
            return;
          }
          response.end(JSON.stringify({ data: [{ id: "claude-sonnet-4-6" }] }));
          return;
        }
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
        messageBodies.push(raw);
        assert.equal(request.headers["x-api-key"], "local-host-test");
        const body = JSON.parse(raw);
        const isTitle = body.model === "gateway-haiku";
        if (isTitle) {
          titleCalls++;
          assert.ok(
            !body.tools?.some((tool) => ["Read", "Write", "Bash", "Agent"].includes(tool.name)),
          );
          assert.ok(JSON.stringify(body.messages).includes("Write proof then reply"));
          assert.ok(!JSON.stringify(body.messages).includes("host attachment proof"));
        } else {
          assert.equal(body.model, "claude-sonnet-4-6");
          assert.ok(
            JSON.stringify(body).includes("Always test"),
            "user CLAUDE.md must apply even with project settings disabled",
          );
          calls++;
        }
        let useTool = !isTitle && [1, 3, 5].includes(calls);
        const content = useTool
          ? [
              {
                type: "tool_use",
                id: `write-proof-${calls}`,
                name: calls === 3 ? "Edit" : "Write",
                input: {
                  file_path: join(directory, "proof.txt"),
                  ...(calls === 3
                    ? { old_string: "x1", new_string: "x3" }
                    : { content: `${proofContent}${calls}` }),
                },
              },
            ]
          : [{ type: "text", text: isTitle ? '{"title":"编写验证文件"}' : "host-contract-ok" }];
        // 真实 CLI 通过终结工具生成 Schema 结果；仅模拟模型响应，仍由 SDK 完成校验和投影。
        const structuredTool = body.tools?.find((tool) => tool.name === "StructuredOutput");
        if (structuredTool) {
          assert.deepEqual(structuredTool.input_schema.required, [isTitle ? "title" : "answer"]);
          content.splice(0, content.length, {
            type: "tool_use",
            id: `structured-${calls}`,
            name: structuredTool.name,
            input: isTitle ? { title: "编写验证文件" } : { answer: "共享宿主结构化答复" },
          });
          useTool = true;
        }
        // 真实 SDK 执行任务工具，验证结构化结果、跨进程恢复与计划投影的完整链路。
        if (!isTitle && calls === 1) {
          assert.ok(body.tools.some((tool) => tool.name === "TaskCreate"));
          content.unshift({
            type: "tool_use",
            id: "create-plan",
            name: "TaskCreate",
            input: { subject: "验证宿主计划", description: "验证跨回合任务关联" },
          });
        } else if (!isTitle && (calls === 3 || calls === 5)) {
          content.unshift({
            type: "tool_use",
            id: `update-plan-${calls}`,
            name: "TaskUpdate",
            input: { taskId: "1", status: calls === 3 ? "in_progress" : "completed" },
          });
        }
        const message = {
          id: `msg-${calls}`,
          type: "message",
          role: "assistant",
          model: body.model,
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
    const userDirectory = join(directory, "native-claude");
    await mkdir(userDirectory);
    // 只在临时用户目录准备原生配置，验证宿主启动后无需再次手工配置连接。
    await writeFile(
      join(userDirectory, "settings.json"),
      JSON.stringify({
        model: "claude-sonnet-4-6",
        availableModels: ["claude-sonnet-4-6", "gateway-haiku"],
        env: {
          ANTHROPIC_API_KEY: "local-host-test",
          ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.address().port}`,
          ANTHROPIC_DEFAULT_HAIKU_MODEL: "gateway-haiku",
        },
      }),
    );
    const launch = () => {
      const child = spawn(
        join(resources, `claude-host${suffix}`),
        [directory, join(resources, `claude${suffix}`)],
        {
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter(
                ([key]) => !/^(ANTHROPIC_|CLAUDE_|CLAUDECODE$)/u.test(key),
              ),
            ),
            HOME: directory,
            USERPROFILE: directory,
            CLAUDE_CONFIG_DIR: userDirectory,
          },
        },
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
          if (operation === "task.settings") result = null;
          else if (operation === "task.read") result = tasks.get(payload.id) ?? null;
          else if (operation === "task.patch" || operation === "task.put") {
            result = { ...tasks.get(payload.id), ...payload };
            tasks.set(payload.id, result);
          } else if (operation === "task.remove") {
            result = tasks.delete(payload.id);
          } else throw new Error(`Unexpected catalog operation ${operation}`);
          send({ catalogId: message.catalogId, result });
        } else if (message.id) {
          const deferred = responses.get(message.id);
          responses.delete(message.id);
          if (message.error) deferred?.reject(new Error(message.error));
          else {
            // 真实独立宿主必须在有序响应帧标记快照边界，不能依赖请求发出时的序号。
            if (message.result?.turns) assert.equal(message.snapshotProjectId, "p");
            deferred?.resolve(message.result);
          }
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
      assert.equal(settings.model, "claude-sonnet-4-6");
      await host.request("settings.write", {
        ...settings,
        instructions: "Always test",
        loadProjectSettings: false,
      });
      const profile = await host.request("profile");
      assert.equal(JSON.stringify(profile).includes("local-host-test"), false);
      assert.deepEqual(profile.configuredModels, [
        { id: "claude-sonnet-4-6", name: "claude-sonnet-4-6" },
        { id: "gateway-haiku", name: "gateway-haiku" },
      ]);
      const options = {
        model: "default",
        reasoningEffort: "",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandboxMode: "workspace-write",
        engineOptions: { engine: "claude", permissionMode: "default" },
      };
      const imagePath = join(directory, "upload.png");
      const filePath = join(directory, "upload.pdf");
      const imageBytes = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      );
      const fileBytes = Buffer.from(`%PDF-1.7\n${"x".repeat(9 * 1024 * 1024)}`);
      await writeFile(imagePath, imageBytes);
      await writeFile(filePath, fileBytes);
      const input = {
        text: "Write proof then reply",
        images: [{ path: imagePath, mediaType: "image/png", detail: "auto" }],
        files: [{ path: filePath, mediaType: "application/pdf", name: "large.pdf" }],
        textAttachments: [{ name: "proof.txt", text: "host attachment proof" }],
        skills: [],
      };
      const initialTurn = await host.request(
        "turn.start",
        { taskId: "task", input, options },
        scope,
      );
      await waitEvent("task.metadata_changed");
      assert.equal(tasks.get("task").title, "编写验证文件");
      assert.ok(titleCalls > 0);
      const pending = (await waitEvent("pending_request.created")).payload.request;
      assert.equal(pending.type, "tool_approval");
      // 真实分发宿主在同一原生回合内接收引导；排队项仍支持读取、排序和取消。
      const emptyInput = { text: "", images: [], files: [], skills: [], textAttachments: [] };
      const queuedA = await host.request(
        "queue.add",
        {
          taskId: "task",
          input: { ...emptyInput, text: "host-queue-cancel-proof" },
          clientUserMessageId: "host-queue-a",
        },
        scope,
      );
      const queuedB = await host.request(
        "queue.add",
        {
          taskId: "task",
          input: { ...emptyInput, text: "host-queued-steer-proof" },
          clientUserMessageId: "host-queue-b",
        },
        scope,
      );
      await host.request(
        "queue.move",
        { taskId: "task", queuedSubmissionId: queuedB.queuedSubmission.id, offset: -1 },
        scope,
      );
      assert.deepEqual(
        (await host.request("queue.list", { taskId: "task" }, scope)).data.map(
          (entry) => entry.text,
        ),
        ["host-queued-steer-proof", "host-queue-cancel-proof"],
      );
      await host.request(
        "queue.delete",
        { taskId: "task", queuedSubmissionId: queuedA.queuedSubmission.id },
        scope,
      );
      const queuedSteer = await host.request(
        "turn.steer",
        {
          taskId: "task",
          turnId: initialTurn.id,
          queuedSubmissionId: queuedB.queuedSubmission.id,
          input: { ...emptyInput, text: "host-queued-steer-proof" },
        },
        scope,
      );
      assert.equal(queuedSteer.turnId, initialTurn.id);
      const liveSteer = await host.request(
        "turn.steer",
        {
          taskId: "task",
          turnId: initialTurn.id,
          input: { ...emptyInput, text: "host-live-steer-proof" },
        },
        scope,
      );
      assert.equal(liveSteer.status, "accepted");
      assert.deepEqual((await host.request("queue.list", { taskId: "task" }, scope)).data, []);

      // 审批输入尚未落盘；两端均不能提前显示为已应用的文件变更。
      assert.equal(
        host.events.some((event) => event.payload?.item?.type === "file_change"),
        false,
      );
      await assert.rejects(readFile(join(directory, "proof.txt")), { code: "ENOENT" });
      // 正在等待工具审批的会话仍持有工作目录，归档和删除必须由适配器拒绝。
      const beforeRemoval = structuredClone(tasks.get("task"));
      for (const method of ["task.archive", "task.delete"]) {
        await assert.rejects(
          host.request(method, { taskId: "task" }, scope),
          /Stop the running task before/,
        );
        assert.deepEqual(tasks.get("task"), beforeRemoval);
      }

      assert.ok(pending.availableDecisions.includes("allow_for_session"));
      await host.request(
        "request.resolve",
        { ...pending, resolution: { decision: "allow_for_session" } },
        scope,
      );
      assert.equal((await waitEvent("turn.completed")).payload.turn.status, "completed");
      const created = host.events.find(
        (event) => event.type === "item.completed" && event.itemId === "write-proof-1",
      ).payload.item;
      assert.equal(created.type, "file_change");
      assert.equal(created.changes[0].kind, "create");
      assert.ok(created.changes[0].diff.includes("省略"));
      assert.equal(await readFile(join(directory, "proof.txt"), "utf8"), `${proofContent}1`);
      assert.deepEqual((await host.request("task.read", { taskId: "task" }, scope)).plan?.steps, [
        { text: "验证宿主计划", status: "pending" },
      ]);
      input.images = [];
      input.files = [];
      input.textAttachments = [];
      await rm(imagePath);
      await rm(filePath);
      assert.equal(JSON.stringify(host.events).includes(imageBytes.toString("base64")), false);
      const sessionId = tasks.get("task").sessionId;
      assert.ok(sessionId);
      // 强制结束 SDK 子进程，再启动同一聊天；精确授权须恢复，不能依赖进程仍在内存。
      await host.request("session.stop", { taskId: "task" }, scope);
      assert.ok(messageBodies.some((body) => body.includes("host-live-steer-proof")));
      assert.ok(messageBodies.some((body) => body.includes("host-queued-steer-proof")));
      assert.ok(!messageBodies.some((body) => body.includes("host-queue-cancel-proof")));
      assert.equal(host.events.filter((event) => event.type === "turn.started").length, 1);
      const afterFirstTurn = host.events.length;
      await host.request("turn.start", { taskId: "task", input, options }, scope);
      assert.equal(
        (await waitEvent("turn.completed", afterFirstTurn)).payload.turn.status,
        "completed",
      );
      assert.equal(
        host.events.slice(afterFirstTurn).some((event) => event.type === "pending_request.created"),
        false,
      );
      const changed = host.events.find(
        (event) => event.type === "item.completed" && event.itemId === "write-proof-3",
      ).payload.item;
      assert.equal(changed.type, "file_change");
      const editedContent = await readFile(join(directory, "proof.txt"), "utf8");
      assert.equal(editedContent.slice(-20), `${proofContent}3`.slice(-20));
      assert.equal(editedContent, `${proofContent}3`);
      assert.equal(changed.changes[0].kind, "update");

      assert.deepEqual((await host.request("task.read", { taskId: "task" }, scope)).plan?.steps, [
        { text: "验证宿主计划", status: "in_progress" },
      ]);
      assert.deepEqual((await host.request("settings.read")).allowedTools, []);
      await host.close();
      host = launch();
      assert.equal((await host.request("settings.read")).instructions, "Always test");
      const native = JSON.parse(await readFile(join(userDirectory, "settings.json"), "utf8"));
      native.effortLevel = "high";
      await writeFile(join(userDirectory, "settings.json"), JSON.stringify(native));
      assert.equal((await host.request("settings.read")).reasoningEffort, "high");
      const restored = await host.request("task.read", { taskId: "task" }, scope);
      assert.equal(restored.turns.length, 2);
      // 搜索只读既有摘要，真实独立宿主重启后仍能按同一消息身份定位，且不发送模型请求。
      const callsBeforeSearch = calls;
      const search = await host.request(
        "search.occurrences",
        { taskId: "task", input: { query: "host-contract-ok" } },
        scope,
      );
      assert.equal(search.data.length, 2);
      const hit = search.data[0];
      const located = await host.request(
        "task.read",
        { taskId: "task", options: { summary: true, cursor: hit.turnCursor } },
        scope,
      );
      assert.ok(
        located.turns.some(
          (turn) => turn.id === hit.turnId && turn.items.some((item) => item.id === hit.itemId),
        ),
      );
      assert.equal(calls, callsBeforeSearch);
      await assert.rejects(
        host.request(
          "search.occurrences",
          { taskId: "task", input: { query: "host-contract-ok" } },
          { ...scope, id: "other" },
        ),
      );
      assert.deepEqual(
        restored.turns[0].items.find((item) => item.id === created.id),
        created,
      );
      assert.deepEqual(
        restored.turns[1].items.find((item) => item.id === changed.id),
        changed,
      );
      const attachments = restored.turns[0].items.find((item) => item.role === "user").attachments;
      const attachment = attachments.find((entry) => entry.kind === "text");
      assert.equal(attachment.name, "proof.txt");
      const exported = await host.request(
        "attachment.export",
        { taskId: "task", attachmentId: attachment.id },
        scope,
      );
      assert.equal(await readFile(exported.path, "utf8"), "host attachment proof");
      assert.equal(exported.mediaType, "text/plain");
      assert.ok(exported.path.endsWith(".txt"));
      for (const entry of attachments.filter((value) => value.kind !== "text")) {
        const content = await host.request(
          "attachment.export",
          { taskId: "task", attachmentId: entry.id },
          scope,
        );
        assert.deepEqual(
          await readFile(content.path),
          entry.kind === "image" ? imageBytes : fileBytes,
        );
      }
      await assert.rejects(
        host.request("attachment.export", { taskId: "task", attachmentId: "missing" }, scope),
      );
      assert.deepEqual(restored.plan?.steps, [{ text: "验证宿主计划", status: "in_progress" }]);
      assert.ok(restored.contextUsage.usedTokens > 0);
      assert.ok(restored.contextUsage.contextWindow > 0);
      const mcpSnapshot = await host.request("mcp.list", { taskId: "task" }, scope);
      assert.deepEqual(mcpSnapshot.data, []);
      assert.equal(mcpSnapshot.statusSource, "cached");
      assert.ok(mcpSnapshot.observedAt);
      // 真实 SDK 必须重读原生配置；整个探测过程不得调用模型或创建展示回合。
      const beforeMcpCalls = calls;
      const boundSession = tasks.get("task").sessionId;
      const currentSettings = await host.request("settings.read");
      await host.request("settings.write", { ...currentSettings, loadProjectSettings: true });
      const mcpFile = join(directory, ".mcp.json");
      const firstOrigin = `http://127.0.0.1:${api.address().port}`;
      const secondOrigin = "http://127.0.0.1:1";
      for (const [servers, action] of [
        [{ docs: { type: "http", url: `${firstOrigin}/mcp` } }, "reload"],
        [
          {
            docs: { type: "http", url: `${secondOrigin}/mcp` },
            added: { type: "http", url: `${firstOrigin}/mcp` },
          },
          "reload",
        ],
        [{ added: { type: "http", url: `${firstOrigin}/mcp` } }, "reload"],
        [{}, "refresh"],
      ]) {
        await writeFile(mcpFile, JSON.stringify({ mcpServers: servers }));
        const status = await host.request("mcp.reload", { taskId: "task", action }, scope);
        assert.equal(status.statusSource, "live");
        assert.ok(status.observedAt);
        assert.deepEqual(
          status.data.map((server) => server.name).sort(),
          Object.keys(servers).sort(),
        );
        for (const server of status.data)
          assert.equal(server.httpOrigin, new URL(servers[server.name].url).origin);
        assert.equal(tasks.get("task").sessionId, boundSession);
      }
      assert.equal(calls, beforeMcpCalls);
      assert.equal((await host.request("task.read", { taskId: "task" }, scope)).turns.length, 2);
      await host.request("settings.write", currentSettings);
      await host.request(
        "turn.start",
        { taskId: "task", input: { ...input, text: "Continue" }, options },
        scope,
      );
      // 应用宿主重启后重新审批，证明 session 许可没有落入用户级永久规则。
      const restartedPending = (await waitEvent("pending_request.created")).payload.request;
      await host.request(
        "request.resolve",
        { ...restartedPending, resolution: { decision: "allow" } },
        scope,
      );
      assert.equal((await waitEvent("turn.completed")).payload.turn.status, "completed");
      assert.equal(tasks.get("task").sessionId, sessionId);
      assert.equal((await host.request("task.read", { taskId: "task" }, scope)).turns.length, 3);
      assert.deepEqual((await host.request("task.read", { taskId: "task" }, scope)).plan?.steps, [
        { text: "验证宿主计划", status: "completed" },
      ]);
      // 同一宿主的开放输入必须承载后续回合，不能在首个 result 后关闭查询。
      const afterSecondTurn = host.events.length;
      await host.request(
        "turn.start",
        { taskId: "task", input: { ...input, text: "Continue again" }, options },
        scope,
      );
      assert.equal(
        (await waitEvent("turn.completed", afterSecondTurn)).payload.turn.status,
        "completed",
      );
      assert.equal((await host.request("task.read", { taskId: "task" }, scope)).turns.length, 4);
      // 对当前 SDK 实际公开的命令验证输出；不假定不同命令采用同一种消息形态。
      for (const name of ["usage", "context"]) {
        assert.ok(profile.commands.some((command) => command.name === name));
        const after = host.events.length,
          callsBeforeCommand = calls;
        await host.request(
          "turn.start",
          { taskId: "task", input: { ...input, text: `/${name}` }, options },
          scope,
        );
        const completed = await waitEvent("turn.completed", after);
        assert.equal(completed.payload.turn.status, "completed");
        const replies = completed.payload.turn.items.filter(
          (item) => item.type === "message" && item.role === "assistant",
        );
        assert.ok(
          replies.some((item) => item.text.trim()),
          `/${name} must display its local output`,
        );
        assert.equal(calls, callsBeforeCommand, `/${name} must not require a model response`);
        assert.deepEqual(
          (await host.request("task.read", { taskId: "task" }, scope)).turns.at(-1).items,
          completed.payload.turn.items,
        );
      }
      // 真实分发宿主按点击回复的原生 UUID 截断，并支持对重建 UUID 的分支再次分叉。
      const firstTurn = (await host.request("task.read", { taskId: "task" }, scope)).turns[0];
      const callsBeforeFork = calls;
      const fork = await host.request(
        "task.fork",
        { taskId: "task", lastTurnId: firstTurn.id },
        scope,
      );
      assert.equal(fork.engine, "claude");
      assert.notEqual(tasks.get(fork.id).sessionId, sessionId);
      const forkSnapshot = await host.request("task.read", { taskId: fork.id }, scope);
      assert.deepEqual(
        forkSnapshot.turns.map((turn) => turn.id),
        [firstTurn.id],
      );
      const nested = await host.request(
        "task.fork",
        { taskId: fork.id, lastTurnId: firstTurn.id },
        scope,
      );
      assert.equal(calls, callsBeforeFork, "forking transcripts must not call the model");
      const beforeCompact = host.events.length;
      assert.deepEqual(await host.request("task.compact", { taskId: nested.id, options }, scope), {
        status: "compacting",
        taskId: nested.id,
      });
      const compacted = await waitEvent("turn.completed", beforeCompact);
      assert.equal(compacted.taskId, nested.id);
      assert.equal(compacted.payload.turn.status, "completed");
      assert.equal(tasks.get("task").sessionId, sessionId);
      // 桌面分发宿主与 Web 使用同一 Provider：普通回合必须接受 Schema 并持久保存结构化结果。
      const beforeSchema = host.events.length;
      await host.request(
        "turn.start",
        {
          taskId: nested.id,
          input: {
            text: "Return a structured answer",
            files: [],
            images: [],
            skills: [],
            textAttachments: [],
            outputSchema: {
              type: "object",
              properties: { answer: { type: "string" } },
              required: ["answer"],
              additionalProperties: false,
            },
          },
          options,
        },
        scope,
      );
      const structured = await waitEvent("turn.completed", beforeSchema);
      assert.equal(structured.payload.turn.status, "completed");
      const structuredItem = structured.payload.turn.items.find(
        (item) =>
          item.type === "message" &&
          item.role === "assistant" &&
          item.text === '{"answer":"共享宿主结构化答复"}',
      );
      assert.ok(structuredItem, "structured output must reach the shared event stream");
      await host.close();
      host = launch();
      const restoredSchema = await host.request("task.read", { taskId: nested.id }, scope);
      assert.ok(
        restoredSchema.turns
          .at(-1)
          .items.some((item) => item.id === structuredItem.id && item.text === structuredItem.text),
      );
      await host.request("task.delete", { taskId: fork.id }, scope);
      await host.request("task.delete", { taskId: nested.id }, scope);
      // 空闲查询仍保持进程存活；归档必须经共享适配器关闭查询后再改目录记录。
      await host.request("task.archive", { taskId: "task" }, scope);
      assert.equal(tasks.get("task").archived, true);
      assert.ok(
        host.events.some(
          (event) => event.type === "task.removed" && event.payload.reason === "archived",
        ),
      );
      // 模拟原生取消归档，供下方已有的历史恢复场景继续使用。
      tasks.get("task").archived = false;
      assert.deepEqual(await host.request("session.stop", { taskId: "task" }, scope), {
        status: "accepted",
        taskId: "task",
      });
      const commandHistory = (
        await host.request("task.read", { taskId: "task" }, scope)
      ).turns.slice(-2);

      // 隐藏临时目录中的原生历史并重启真实宿主；已有 UI 历史绝不能被当成模型上下文。
      await host.close();
      const nativeProjects = join(userDirectory, "projects");
      await rename(nativeProjects, `${nativeProjects}.saved`);
      host = launch();
      const beforeMissing = structuredClone(tasks.get("task"));
      const callsBeforeMissing = calls;
      await assert.rejects(
        host.request("turn.start", { taskId: "task", input, options }, scope),
        /恢复.*历史/,
      );
      assert.deepEqual(tasks.get("task"), beforeMissing);
      assert.equal(calls, callsBeforeMissing);
      assert.equal(
        host.events.some((event) => event.type === "turn.started"),
        false,
      );
      assert.equal((await host.request("task.read", { taskId: "task" }, scope)).turns.length, 6);
      assert.deepEqual(
        (await host.request("task.read", { taskId: "task" }, scope)).turns.slice(-2),
        commandHistory,
      );
      await rename(`${nativeProjects}.saved`, nativeProjects);

      await host.request("configure", {
        baseUrl: `http://127.0.0.1:${api.address().port}`,
        models: [],
        authType: "auto",
        apiKey: "detected-token",
      });
      const detectedProfile = await host.request("profile");
      assert.deepEqual(detectedProfile.configuredModels, []);
      assert.equal(detectedProfile.authType, "authToken");
      await host.request("disconnect");
      assert.equal((await host.request("profile")).connection.state, "disconnected");
      assert.equal((await host.request("settings.read")).instructions, "Always test");
      assert.equal((await host.request("task.read", { taskId: "task" }, scope)).turns.length, 6);
      // 真实 SDK 的会话及应用历史必须实际存在，防止空目录清理造成假阳性。
      assert.ok(
        (await readdir(nativeProjects, { recursive: true })).some((path) =>
          path.endsWith(`${sessionId}.jsonl`),
        ),
      );
      await host.request("task.delete", { taskId: "task" }, scope);
      const taskHash = createHash("sha256").update("task").digest("hex");
      assert.equal(
        (await readdir(join(directory, "transcripts"), { recursive: true })).some((path) =>
          path.includes(taskHash),
        ),
        false,
      );
      assert.equal(
        (await readdir(nativeProjects, { recursive: true })).some((path) =>
          path.includes(sessionId),
        ),
        false,
      );

      assert.equal(tasks.has("task"), false);
      assert.ok(
        host.events.some(
          (event) => event.type === "task.removed" && event.payload.reason === "deleted",
        ),
      );
      await assert.rejects(readFile(exported.path), { code: "ENOENT" });
    } finally {
      await host.close();
      api.closeAllConnections();
      await new Promise((resolve) => api.close(resolve));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
