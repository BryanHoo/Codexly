import { fileURLToPath } from "node:url";

import { CodexlyClient } from "@codexly/client";
import type { AgentEvent } from "@codexly/protocol";
import { AcpApplicationRuntime, AcpProcess } from "@codexly/provider-acp";
import { createCodexlyServer } from "@codexly/server";
import { expect, it } from "vitest";
import { WebSocket as NodeWebSocket } from "ws";

import { createServerOptions } from "../packages/server/src/app-options.test-support.js";
import { LocalProjectRepository } from "../packages/server/src/local-project-repository.js";
import {
  createWorkspace,
  openRepository,
} from "../packages/server/src/sqlite-state-repository.test-support.js";

it.each(["codex", "claude"] as const)(
  "streams a %s ACP prompt through the HTTP server and WebSocket",
  async (engine) => {
    const root = await createWorkspace();
    const store = await openRepository(root);
    const project = {
      id: "p",
      createdAt: "2026-07-23T00:00:00.000Z",
      name: "ACP project",
      roots: [{ id: "root", path: root }],
    };
    await store.catalog("project.put", {
      id: project.id,
      createdAt: project.createdAt,
      name: project.name,
      path: root,
    });
    await store.catalog("task.put", {
      id: "task-realtime",
      projectId: project.id,
      title: "ACP",
      cwd: root,
      provider: engine,
      sessionId: "fixture-existing",
      updatedAt: Math.floor(Date.now() / 1_000),
      pinned: false,
      archived: false,
      status: "idle",
    });
    const script = fileURLToPath(new URL("./fixtures/fake-acp-agent.mjs", import.meta.url));
    const runtime = new AcpApplicationRuntime(
      root,
      store,
      () => store.readGlobalSettings(),
      (_engine, scope, callbacks) =>
        AcpProcess.start(
          { command: process.execPath, args: [script], cwd: scope.rootPath },
          callbacks,
        ),
    );
    const app = await createCodexlyServer({
      ...createServerOptions(runtime.forProject(project), {
        projectRepository: new LocalProjectRepository(store, store),
      }),
      provider: runtime,
      acpAgents: runtime.acpAgents,
      submissionRepository: store,
    });
    try {
      const baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
      const client = new CodexlyClient({
        baseUrl,
        // Node 测试显式附带浏览器建立 WebSocket 时使用的同源 Origin。
        webSocketFactory: (url) =>
          new NodeWebSocket(url, { origin: baseUrl }) as unknown as WebSocket,
      });
      const taskId = "task-realtime";
      const { checkpoint, snapshot } = await client.readTask(project.id, taskId);
      expect(snapshot.turns).not.toHaveLength(0);
      const events: AgentEvent[] = [];
      let socketError: unknown;
      const unsubscribe = client.subscribeEvents({
        afterSequence: checkpoint.sequence,
        sessionId: checkpoint.sessionId,
        projectId: project.id,
        onEvent: (event) => {
          events.push(event);
        },
        onError: (error) => {
          socketError = error;
        },
        onResyncRequired: ({ reason }) => {
          socketError = new Error(reason);
        },
      });
      try {
        const prompt = await app.inject({
          method: "POST",
          url: "/v1/projects/p/submissions",
          headers: { "idempotency-key": "acp-realtime" },
          payload: {
            type: "acp-prompt",
            engine,
            taskId,
            input: { type: "prompt", text: "开始流式回复", attachments: [], skills: [] },
          },
        });
        expect(prompt.statusCode, prompt.body).toBe(201);
        await expect.poll(() => events.some(({ type }) => type === "turn.completed")).toBe(true);
        expect(socketError).toBeUndefined();
        expect(events.some(({ type }) => type === "turn.started")).toBe(true);
        expect(
          events
            .filter((event) => event.type === "message.delta")
            .map((event) => event.payload.delta)
            .join(""),
        ).toBe("流式回复完成");
      } finally {
        unsubscribe();
      }
    } finally {
      await app.close();
      await runtime.close();
    }
  },
);
