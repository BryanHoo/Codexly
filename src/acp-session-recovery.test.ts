import { expect, it, vi } from "vitest";
import { AcpApplicationRuntime } from "@codexly/provider-acp";
import {
  createPersistentAgentPeer,
  startConfiguredAcpTurn,
} from "../packages/provider-acp/test/persistent-agent.test-support.js";
import {
  createWorkspace,
  openRepository,
} from "../packages/server/src/sqlite-state-repository.test-support.js";

it.each(["codex", "claude"] as const)(
  "%s 首次默认值应用失败后重启沿原会话恢复冻结配置",
  async (engine) => {
    const root = await createWorkspace(),
      store = await openRepository(root);
    const applied = vi.fn().mockImplementationOnce(() => {
      throw new Error("配置中断");
    });
    const peer = createPersistentAgentPeer(applied);
    const open = () =>
      new AcpApplicationRuntime(root, store, () => Promise.resolve(undefined), peer.launch);
    let runtime = open();
    try {
      await runtime.settings.update(engine, (current) => ({
        ...current,
        configured: true,
        values: { model: "model-b" },
      }));
      const provider = runtime.forTemporary(root);
      const task = await provider.startTask({ engine });
      await store.catalog("task.patch", { id: task.id, title: "保留手动标题" });
      const input = { text: "第一条", files: [], images: [], skills: [], textAttachments: [] };
      await expect(startConfiguredAcpTurn(provider, task.id, input)).rejects.toThrow();
      expect(peer.prompts).toEqual([]);
      const binding = await store.catalog("task.read", { id: task.id });
      expect(binding?.sessionId).toBeTruthy();
      await runtime.close();
      runtime = open();
      // 另一端改变全局默认值，不能改变已创建会话尚未完成的初始化意图。
      await runtime.settings.update(engine, (current) => ({
        ...current,
        values: { model: "model-a" },
      }));
      await startConfiguredAcpTurn(runtime.forTemporary(root), task.id, input);
      await vi.waitFor(() => {
        expect(peer.prompts).toEqual(["第一条"]);
      });
      expect(applied.mock.calls).toEqual([
        ["model", "model-b"],
        ["model", "model-b"],
      ]);
      expect(peer.loaded).toEqual([binding?.sessionId]);
      expect((await store.catalog("task.read", { id: task.id }))?.sessionId).toBe(
        binding?.sessionId,
      );
    } finally {
      await runtime.close();
    }
  },
);

it.each(["codex", "claude"] as const)(
  "%s 新会话目录绑定写入失败后从初始化日志恢复原身份",
  async (engine) => {
    const root = await createWorkspace(),
      store = await openRepository(root);
    const peer = createPersistentAgentPeer();
    const open = () =>
      new AcpApplicationRuntime(root, store, () => Promise.resolve(undefined), peer.launch);
    let runtime = open();
    const catalog = store.catalog.bind(store);
    try {
      const task = await runtime.forTemporary(root).startTask({ engine });
      await store.catalog("task.patch", { id: task.id, title: "保留手动标题" });
      const fail = vi.spyOn(store, "catalog").mockImplementation((operation, payload) => {
        if (
          operation === "task.patch" &&
          payload &&
          typeof payload === "object" &&
          "sessionId" in payload
        )
          return Promise.reject(new Error("目录绑定落盘失败"));
        return catalog(operation, payload);
      });
      const input = { text: "第一条", files: [], images: [], skills: [], textAttachments: [] };
      await expect(
        startConfiguredAcpTurn(runtime.forTemporary(root), task.id, input),
      ).rejects.toThrow("目录绑定落盘失败");
      fail.mockRestore();
      expect((await store.catalog("task.read", { id: task.id }))?.sessionId).toBeNull();
      expect(peer.prompts).toEqual([]);
      await runtime.close();
      runtime = open();
      await startConfiguredAcpTurn(runtime.forTemporary(root), task.id, input);
      await vi.waitFor(() => {
        expect(peer.prompts).toEqual(["第一条"]);
      });
      expect(peer.loaded).toEqual(["native-1"]);
      expect([...peer.transcripts.keys()]).toEqual(["native-1"]);
      expect((await store.catalog("task.read", { id: task.id }))?.sessionId).toBe("native-1");
    } finally {
      vi.restoreAllMocks();
      await runtime.close();
    }
  },
);
