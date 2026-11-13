import { startConfiguredAcpTurn } from "../packages/provider-acp/test/persistent-agent.test-support.js";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { AcpApplicationRuntime } from "@codexly/provider-acp";
import { SqliteStateRepository } from "@codexly/server";

// 只有显式开启真实账号验收时才调用模型；应用数据和工作目录隔离，不读取已有用户任务。
it.skipIf(process.env["CODEXLY_REAL_ACCOUNT_TEST"] !== "1").each(["codex", "claude"] as const)(
  "%s 官方 adapter 的真实账号首发与重启续聊保留会话及回合身份",
  async (engine) => {
    const root = await mkdtemp(join(tmpdir(), "acp-real-history-"));
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    let store: SqliteStateRepository | undefined, runtime: AcpApplicationRuntime | undefined;
    const open = async () => {
      store = await SqliteStateRepository.open(join(root, "state.sqlite3"));
      runtime = new AcpApplicationRuntime(join(root, "engines", "acp"), store, () =>
        Promise.resolve(undefined),
      );
      return runtime.forTemporary(workspace);
    };
    const repository = () => {
      if (!store) throw new Error("验收数据库未打开");
      return store;
    };
    const close = async () => {
      try {
        await runtime?.close();
      } finally {
        runtime = undefined;
        await store?.close();
        store = undefined;
      }
    };
    try {
      let provider = await open();
      const task = await provider.startTask({ engine });
      await repository().catalog("task.patch", { id: task.id, title: "ACP 隔离验收" });
      const input = (text: string) => ({
        text,
        files: [],
        images: [],
        skills: [],
        textAttachments: [],
      });
      const first = await startConfiguredAcpTurn(
        provider,
        task.id,
        input("仅回复 ACP_OK。不要读取文件或调用工具。"),
      );
      await vi.waitFor(
        async () => {
          const snapshot = await provider.readTask(task.id);
          if (!snapshot) throw new Error("ACP snapshot unavailable");
          expect(snapshot.turns.at(-1)?.status).toBe("completed");
          expect(JSON.stringify(snapshot.turns)).toContain("ACP_OK");
        },
        { timeout: 60_000, interval: 200 },
      );
      const original = await repository().catalog("task.read", { id: task.id });
      await close();
      provider = await open();
      await startConfiguredAcpTurn(
        provider,
        task.id,
        input("仅回复 ACP_RESUME_OK。不要读取文件或调用工具。"),
      );
      await vi.waitFor(
        async () => {
          const snapshot = await provider.readTask(task.id);
          if (!snapshot) throw new Error("ACP snapshot unavailable");
          expect(snapshot.turns).toHaveLength(2);
          expect(snapshot.turns[0]?.id).toBe(first.id);
          expect(snapshot.turns[1]?.status).toBe("completed");
          expect(JSON.stringify(snapshot.turns[1])).toContain("ACP_RESUME_OK");
        },
        { timeout: 60_000, interval: 200 },
      );
      expect((await repository().catalog("task.read", { id: task.id }))?.sessionId).toBe(
        original?.sessionId,
      );
    } catch (error) {
      // 第三方错误可能带 URL 或认证详情；真实验收日志只暴露阶段错误类型。
      // oxlint-disable-next-line preserve-caught-error -- 原厂错误可能携带凭据，验收输出仅保留错误类型。
      throw new Error(
        `ACP_REAL_HISTORY_${engine.toUpperCase()}_${error instanceof Error ? error.name : "FAILED"}`,
      );
    } finally {
      await close();
      await rm(root, { recursive: true, force: true });
    }
  },
  150_000,
);
