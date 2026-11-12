import { expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { PassThrough, Writable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as acp from "@agentclientprotocol/sdk/unstable";
import {
  applicationPreferencesFromLegacy,
  type CatalogOperations,
  type LocalCatalogStore,
  type LocalTask,
  type AgentProviderEvent,
} from "@codexly/core";
import { AcpRuntime, type AcpAgentLauncher } from "./runtime.js";
import { AcpConnection } from "./connection.js";
import { runAcpHost } from "./host-entry.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "acp-auto-title-"));
  const tasks = new Map<string, LocalTask>();
  const claims = new Map<string, string>();
  const entered = Promise.withResolvers<undefined>();
  const output = Promise.withResolvers<undefined>();
  const finishMain = Promise.withResolvers<undefined>();
  const titleEntered = Promise.withResolvers<undefined>();
  const finishTitle = Promise.withResolvers<undefined>();
  const cancelled = Promise.withResolvers<undefined>();
  const prompts: { engine: string; text: string }[] = [];
  const closed: string[] = [];
  const catalog = vi.fn((operation: string, payload: unknown): Promise<unknown> =>
    Promise.resolve().then(() => {
      const p = payload as LocalTask & { token: string };
      switch (operation) {
        case "task.put":
          tasks.set(p.id, { ...p });
          return p;
        case "task.read":
          return tasks.get(p.id) ?? null;
        case "task.preview":
          return null;
        case "task.patch": {
          const previous = tasks.get(p.id);
          if (!previous) throw new Error("未找到任务");
          const task = { ...previous, ...p };
          tasks.set(p.id, task);
          if (Object.hasOwn(p, "title") || p.archived) claims.set(p.id, "invalid");
          return task;
        }
        case "app.preferences.read":
          return applicationPreferencesFromLegacy({
            defaultAgent: "claude",
            defaultModel: null,
            taskTitlePrompt: "只概括用户的修复目标",
          });
        case "acp.title.claim":
          if (claims.has(p.id)) return false;
          claims.set(p.id, p.token);
          return true;
        case "acp.title.finish": {
          const task = tasks.get(p.id);
          if (claims.get(p.id) !== p.token || !task || task.title || task.archived) return null;
          claims.set(p.id, "done");
          if (p.title) tasks.set(p.id, { ...task, title: p.title });
          return p.title;
        }
        default:
          throw new Error(operation);
      }
    }),
  );
  let session = 0;
  const launch: AcpAgentLauncher = async (engine, _scope, callbacks) => {
    const a = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
    const b = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
    const peer = acp
      .agent({ name: "title-test" })
      .onRequest(acp.methods.agent.initialize, () => ({
        protocolVersion: 1,
        agentCapabilities: { sessionCapabilities: { close: {} } },
      }))
      .onRequest(acp.methods.agent.session.new, () => ({
        sessionId: `session-${String(++session)}`,
      }))
      .onRequest(acp.methods.agent.session.close, ({ params }) => {
        closed.push(params.sessionId);
        return {};
      })
      .onNotification(acp.methods.agent.session.cancel, () => {
        cancelled.resolve(undefined);
        finishTitle.resolve(undefined);
      })
      .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
        const text = params.prompt
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
        prompts.push({ engine, text });
        const helper = params.sessionId !== "session-1";
        if (helper) {
          titleEntered.resolve(undefined);
          await finishTitle.promise;
        } else {
          entered.resolve(undefined);
          await output.promise;
        }
        await client.notify(acp.methods.client.session.update, {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: helper ? '{"title":"修复并发状态更新"}' : "正在修复" },
          },
        });
        if (!helper) await finishMain.promise;
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
  const store: LocalCatalogStore = {
    catalog: <K extends keyof CatalogOperations>(operation: K, payload: CatalogOperations[K][0]) =>
      catalog(operation, payload) as Promise<CatalogOperations[K][1]>,
  };
  const runtime = new AcpRuntime(root, store, launch);
  const provider = runtime.forTemporary(root);
  const events: AgentProviderEvent[] = [];
  provider.subscribeEvents((event) => {
    events.push(event);
  });
  const task = await provider.startTask({ engine: "codex" });
  const input = {
    text: "修复状态更新覆盖手动名称",
    files: [],
    images: [],
    skills: [],
    textAttachments: [],
  };
  return {
    root,
    launch,
    runtime,
    provider,
    task,
    input,
    tasks,
    catalog,
    prompts,
    closed,
    events,
    entered,
    output,
    finishMain,
    titleEntered,
    finishTitle,
    cancelled,
    async close() {
      output.resolve(undefined);
      finishMain.resolve(undefined);
      finishTitle.resolve(undefined);
      await runtime.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

it("首发真实 ACP 输出后才生成标题，主回合不等待辅助生成且无递归任务", async () => {
  const f = await fixture();
  try {
    if (!f.provider.startConfiguredTurn) throw new Error("缺少 ACP 提交端口");
    await f.provider.startConfiguredTurn(f.task.id, f.input);
    await f.entered.promise;
    expect(f.prompts).toHaveLength(1);
    expect(f.catalog.mock.calls.some(([op]) => op === "app.preferences.read")).toBe(false);
    f.output.resolve(undefined);
    await vi.waitFor(() => {
      expect(f.prompts).toHaveLength(2);
    });
    expect(f.prompts[1]).toMatchObject({ engine: "claude" });
    expect(f.prompts[1]?.text).toContain("只概括用户的修复目标");
    f.finishMain.resolve(undefined);
    await vi.waitFor(() => {
      expect(f.events.some((event) => event.type === "turn.completed")).toBe(true);
    });
    expect(f.tasks.get(f.task.id)?.title).toBe("");
    f.finishTitle.resolve(undefined);
    await vi.waitFor(() => {
      expect(f.tasks.get(f.task.id)?.title).toBe("修复并发状态更新");
    });
    expect(f.events.filter((event) => event.type === "task.metadata_changed")).toMatchObject([
      { taskId: f.task.id, payload: { title: "修复并发状态更新" } },
    ]);
    expect(f.tasks.size).toBe(1);
    expect(f.closed).toHaveLength(1);
    expect(f.prompts).toHaveLength(2);
  } finally {
    await f.close();
  }
});

it("手动命名取消在途 ACP 标题，迟到结果不能覆盖用户名称", async () => {
  const f = await fixture();
  try {
    if (!f.provider.startConfiguredTurn) throw new Error("缺少 ACP 提交端口");
    await f.provider.startConfiguredTurn(f.task.id, f.input);
    f.output.resolve(undefined);
    await vi.waitFor(() => {
      expect(f.prompts).toHaveLength(2);
    });
    await f.provider.renameTask(f.task.id, "用户名称");
    await vi.waitFor(() => {
      expect(f.closed).toHaveLength(1);
    });
    expect(f.tasks.get(f.task.id)?.title).toBe("用户名称");
    expect(f.events.filter((event) => event.type === "task.metadata_changed")).toMatchObject([
      { payload: { title: "用户名称" } },
    ]);
  } finally {
    await f.close();
  }
});

it("释放项目会取消在途标题并回收共享 ACP 连接", async () => {
  const f = await fixture();
  try {
    if (!f.provider.startConfiguredTurn) throw new Error("缺少 ACP 提交端口");
    await f.provider.startConfiguredTurn(f.task.id, f.input);
    f.output.resolve(undefined);
    await vi.waitFor(() => {
      expect(f.prompts).toHaveLength(2);
    });
    f.finishMain.resolve(undefined);
    await f.runtime.releaseProject("temporary", f.provider);
    expect(f.tasks.get(f.task.id)?.title).toBe("");
    expect(f.events.filter((event) => event.type === "task.metadata_changed")).toHaveLength(0);
    await expect(f.provider.startTask()).rejects.toThrow("关闭");
  } finally {
    await f.close();
  }
});

it("原生宿主从可信第四参数只读旧公共偏好，反向目录调用完成自动命名", async () => {
  const f = await fixture();
  const directory = join(f.root, "application");
  await mkdir(directory);
  const original =
    '{"version":1,"global":{"defaultAgent":"claude","defaultModel":null,"taskTitlePrompt":"只提取原生修复目标"},"projects":{}}\n';
  await writeFile(join(directory, "agent-settings.json"), original);
  const catalog = f.catalog.getMockImplementation();
  if (!catalog) throw new Error("缺少目录夹具");
  f.catalog.mockImplementation((operation, payload) =>
    operation === "app.preferences.read" ? Promise.resolve(null) : catalog(operation, payload),
  );
  const input = new PassThrough();
  const frames: Record<string, unknown>[] = [];
  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      const frame = JSON.parse(chunk.toString()) as Record<string, unknown>;
      if (typeof frame["catalogId"] === "number") {
        void f.catalog(frame["operation"] as string, frame["payload"]).then(
          (result) => {
            input.write(`${JSON.stringify({ catalogId: frame["catalogId"], result })}\n`);
          },
          () => {
            input.write(
              `${JSON.stringify({ catalogId: frame["catalogId"], error: "rejected" })}\n`,
            );
          },
        );
      } else frames.push(frame);
      callback();
    },
  });
  const running = runAcpHost(
    [join(f.root, "native-acp"), process.execPath, process.execPath, directory],
    { input, output },
    f.launch,
  );
  try {
    input.write(
      `${JSON.stringify({ id: 1, method: "prompt.start", scope: { id: "temporary", kind: "temporary", rootPath: f.root, runtimeWorkspaceRoots: [f.root] }, params: { taskId: f.task.id, input: f.input } })}\n`,
    );
    await f.entered.promise;
    f.output.resolve(undefined);
    await vi.waitFor(() => {
      expect(f.prompts).toHaveLength(2);
    });
    expect(f.prompts[1]).toMatchObject({ engine: "claude" });
    expect(f.prompts[1]?.text).toContain("只提取原生修复目标");
    f.finishTitle.resolve(undefined);
    f.finishMain.resolve(undefined);
    await vi.waitFor(() => {
      expect(
        frames.some(
          (frame) =>
            (frame["event"] as AgentProviderEvent | undefined)?.type === "task.metadata_changed",
        ),
      ).toBe(true);
    });
    expect(f.tasks.get(f.task.id)?.title).toBe("修复并发状态更新");
    expect(f.catalog.mock.calls.map(([operation]) => operation)).not.toContain("generation.title");
    expect(await readFile(join(directory, "agent-settings.json"), "utf8")).toBe(original);
  } finally {
    f.output.resolve(undefined);
    f.finishTitle.resolve(undefined);
    f.finishMain.resolve(undefined);
    input.end();
    await running;
    output.destroy();
    await f.close();
  }
});
