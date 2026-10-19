import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  createCodexRuntimeProvider,
  createLocalCatalogClient,
  startCodexAppServer,
} from "@codexly/provider-codex";
import { SqliteStateRepository } from "../packages/server/src/sqlite-state-repository.js";
import { generateCommitMessageWithCodex } from "../packages/server/src/server-runtime.js";
import { enableClaudeRuntime } from "./cli-engine-runtime.js";

// 真实 App Server + 本地 SSE 模型，验证完整临时线程链路，不读取用户配置或消耗模型额度。
it.runIf(process.env["CODEXLY_REAL_RUNTIME_TEST"] === "1")(
  "returns a Git message from the real Codex runtime through the lazy engine router",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "codexly-commit-runtime-"));
    let calls = 0;
    const server = createServer((request, response) => {
      // 消费正文以完成真实 HTTP 请求，不记录提示词。
      request.resume();
      request.once("end", () => {
        calls++;
        const events = [
          { type: "response.created", response: { id: "response-local" } },
          {
            type: "response.output_item.done",
            item: {
              id: "message-local",
              type: "message",
              role: "assistant",
              phase: "final_answer",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({ message: "fix(git): 修复生成完成事件转发" }),
                },
              ],
            },
          },
          {
            type: "response.completed",
            response: {
              id: "response-local",
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            },
          },
        ];
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing local server address");
    const store = await SqliteStateRepository.open(join(root, "state.sqlite3"));
    let codexProcess: Awaited<ReturnType<typeof startCodexAppServer>> | undefined;
    let runtime: ReturnType<typeof enableClaudeRuntime> | undefined;
    try {
      await writeFile(
        join(root, "config.toml"),
        `model = "gpt-6-luna"\nmodel_provider = "local"\n[model_providers.local]\nname = "Local regression model"\nbase_url = "http://127.0.0.1:${String(address.port)}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`,
      );
      codexProcess = await startCodexAppServer({
        cwd: root,
        env: { ...globalThis.process.env, CODEX_HOME: root },
      });
      await store.catalog("project.put", {
        id: "project",
        name: "测试项目",
        path: root,
        createdAt: "2026-10-19T00:00:00Z",
      });
      const client = await createLocalCatalogClient(codexProcess.client, store);
      runtime = enableClaudeRuntime(
        createCodexRuntimeProvider({ client, codexHome: root }),
        store,
        root,
      );
      const provider = runtime.forProject({
        id: "project",
        name: "测试项目",
        roots: [{ id: "root", path: root }],
        createdAt: "2026-10-19T00:00:00Z",
      });
      const message = await generateCommitMessageWithCodex(
        provider,
        "Generate a commit message for a one-line fix.",
        {
          model: "gpt-6-luna",
          reasoningEffort: "",
          approvalPolicy: "never",
          approvalsReviewer: "user",
          sandboxMode: "read-only",
        },
      );
      expect(message).toBe("fix(git): 修复生成完成事件转发");
      expect(calls).toBe(1);
      expect(await store.catalog("task.list", { projectId: "project" })).toMatchObject({
        data: [],
      });
    } finally {
      await runtime?.releaseProject("project");
      await codexProcess?.close();
      await store.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);
