import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { ApplicationPreferencesService } from "@codexly/core";
import type { TaskSearchPage, SearchOccurrencesPage } from "@codexly/protocol";
import {
  createCodexlyServer,
  LocalProjectRepository,
  SqliteStateRepository,
} from "@codexly/server";
import { createPersistentAgentPeer } from "../packages/provider-acp/test/persistent-agent.test-support.js";
import { createCliAcpRuntime } from "./cli-acp-runtime.js";
import { runCli } from "./cli-command.js";
import { createHarness, temporaryDirectories } from "./cli-command.test-support.js";

it("真实 CLI / HTTP / SQLite 使用共享 ACP，Codex 离线不阻断 Claude 聊天、搜索和重启恢复", async () => {
  const root = await mkdtemp(join(tmpdir(), "codexly-acp-start-"));
  temporaryDirectories.push(root);
  let store = await SqliteStateRepository.open(join(root, "state.sqlite3"));
  const project = await new LocalProjectRepository(store, store).register({
    name: "Claude 项目",
    roots: [{ path: root }],
    idempotencyKey: "project",
  });
  await new ApplicationPreferencesService(store, () => Promise.resolve(undefined)).patch({
    defaultAgent: "claude",
    defaultModel: "model-a",
  });
  const peer = createPersistentAgentPeer();
  let codexOnline = false;
  const launch = vi.fn<typeof peer.launch>((...args) => {
    if (args[0] === "codex" && !codexOnline) return Promise.reject(new Error("Codex unavailable"));
    return peer.launch(...args);
  });
  let address: string | undefined;
  const harness = createHarness({
    appDataDirectory: root,
    createStateRepository: () => Promise.resolve(store),
    createProjectRepository: () => new LocalProjectRepository(store, store),
    createAcpRuntime: (input) => createCliAcpRuntime({ ...input, launch }),
    createServer: async (input) => {
      const app = await createCodexlyServer({ ...input, loggerEnabled: false });
      return {
        close: () => app.close(),
        listen: async () => {
          address = await app.listen({ host: "127.0.0.1", port: 0 });
          return address;
        },
      };
    },
  });
  const request = async (path: string, payload?: unknown) => {
    const response = await fetch(
      `${address ?? ""}${path}`,
      payload === undefined
        ? {}
        : {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
            body: JSON.stringify(payload),
          },
    );
    const body: unknown = await response.json();
    expect(response.ok, JSON.stringify({ path, body })).toBe(true);
    return body;
  };
  const start = () => {
    const controller = new AbortController();
    const run = runCli(["start", "--no-open", "--codex-home", root], {
      ...harness.options,
      signal: controller.signal,
    });
    return {
      run,
      stop: async () => {
        controller.abort();
        await expect(run).resolves.toBe(0);
      },
    };
  };
  let running = start(),
    historyPath = "";
  try {
    await vi.waitFor(() => {
      expect(address).toBeDefined();
    });
    expect(launch).not.toHaveBeenCalled();
    const created = (await request(`/v1/projects/${project.id}/tasks`, { engine: "claude" })) as {
      task: { id: string };
    };
    await store.catalog("task.patch", { id: created.task.id, title: "保留手动标题" });
    historyPath = `/v1/projects/${project.id}/tasks/${created.task.id}`;
    await request(`/v1/projects/${project.id}/submissions`, {
      type: "acp-prompt",
      taskId: created.task.id,
      input: { type: "prompt", text: "hello", attachments: [], skills: [] },
    });
    // HTTP 提交仅确认受理；等待异步队列和落盘完成，不能把默认 1 秒轮询期限当成执行预算。
    await vi.waitFor(
      async () => {
        expect(await request(historyPath)).toMatchObject({
          snapshot: {
            runtime: "acp",
            engine: "claude",
            turns: [expect.objectContaining({ status: "completed" })],
          },
        });
      },
      { timeout: 10_000 },
    );
    await vi.waitFor(
      async () => {
        expect((await store.catalog("task.read", { id: created.task.id }))?.status).toBe("idle");
      },
      { timeout: 10_000 },
    );
    const hits = (await request(
      "/v1/search/tasks?query=hello&kind=history&archived=false",
    )) as TaskSearchPage;
    expect(hits.data[0]?.task).toMatchObject({ id: created.task.id, engine: "claude" });
    expect(
      ((await request(`${historyPath}/search-occurrences?query=hello`)) as SearchOccurrencesPage)
        .data[0]?.turnId,
    ).toBeTypeOf("string");
    expect(launch.mock.calls.every(([engine]) => engine === "claude")).toBe(true);
    expect((await fetch(`${address ?? ""}/v1/acp/agents/codex`)).ok).toBe(false);
    expect(await request(historyPath)).toMatchObject({ snapshot: { engine: "claude" } });
    codexOnline = true;
    expect(await request("/v1/acp/agents/codex/defaults")).toMatchObject({
      configOptions: [expect.objectContaining({ id: "model" })],
    });
    const codexTask = (await request(`/v1/projects/${project.id}/tasks`, { engine: "codex" })) as {
      task: { id: string };
    };
    await store.catalog("task.patch", {
      id: codexTask.task.id,
      sessionId: "external-codex-history",
    });
    // 尚无本地投影的离线引擎必须明确报不可用，不能把旧 SDK 当作回退搜索源。
    await running.stop();
    store = await SqliteStateRepository.open(join(root, "state.sqlite3"));
    address = undefined;
    codexOnline = false;
    launch.mockClear();
    running = start();
    await vi.waitFor(() => {
      expect(address).toBeDefined();
    });
    expect(await request(historyPath)).toMatchObject({
      snapshot: {
        runtime: "acp",
        engine: "claude",
        turns: [expect.objectContaining({ status: "completed" })],
      },
    });
    expect(launch).not.toHaveBeenCalled();
    expect(
      await request("/v1/search/tasks?query=hello&kind=history&archived=false&engines=claude"),
    ).toMatchObject({ data: [{ task: { engine: "claude" } }] });
    expect(launch).not.toHaveBeenCalled();
    expect(
      await request(
        "/v1/search/tasks?query=hello&kind=history&archived=false&engines=codex,claude",
      ),
    ).toMatchObject({ data: [{ task: { engine: "claude" } }], unavailableEngines: ["codex"] });
    expect(harness.dependencies.startCodexAppServer).not.toHaveBeenCalled();
    expect(harness.dependencies.createRuntimeProvider).not.toHaveBeenCalled();
  } finally {
    await running.stop();
  }
});
