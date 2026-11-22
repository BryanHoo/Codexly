import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { methods } from "@agentclientprotocol/sdk/unstable";
import type { LocalCatalogStore, LocalTask } from "@codexly/core";
import type { AgentEngine } from "@codexly/protocol";
import type { AcpConnection } from "./connection.js";

/** 只读取 ACP 目录，不加载正文或创建会话；旧绑定和用户管理状态始终优先。 */
export async function importAcpCatalog(
  engine: AgentEngine,
  connection: AcpConnection,
  store: LocalCatalogStore,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (!connection.initialization.agentCapabilities?.sessionCapabilities?.list)
    throw new Error("ACP agent 不支持历史目录发现");
  const [projects, bindings] = await Promise.all([
    store.catalog("project.list", undefined),
    store.catalog("task.bindings", undefined),
  ]);
  if (bindings.length > 100_000) throw new Error("ACP 目录迁移超过任务预算");
  const known = new Set(
    bindings
      .filter((task) => task.provider === engine && task.sessionId)
      .map((task) => task.sessionId),
  );
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let discovered = 0;
  do {
    signal?.throwIfAborted();
    const page = await connection.transport.agent.request(
      methods.agent.session.list,
      cursor ? { cursor } : {},
      signal ? { cancellationSignal: signal, stopWaitingOnCancel: true } : undefined,
    );
    for (const session of page.sessions) {
      signal?.throwIfAborted();
      if (++discovered > 100_000) throw new Error("ACP 目录迁移超过任务预算");
      if (known.has(session.sessionId)) continue;
      if (!session.sessionId || !isAbsolute(session.cwd))
        throw new Error("ACP 历史会话身份或工作目录无效");
      const matched = projects.filter((project) => project.path === session.cwd);
      const date = session.updatedAt ? Date.parse(session.updatedAt) : NaN;
      const task: LocalTask = {
        id: `acp-import-${engine}-${createHash("sha256").update(session.sessionId).digest("hex")}`,
        provider: engine,
        sessionId: session.sessionId,
        cwd: session.cwd,
        // 无法唯一关联项目时保持普通聊天；不能根据标题或相似路径猜测旧项目归属。
        projectId: matched.length === 1 ? (matched[0]?.id ?? null) : null,
        title: session.title ?? "",
        pinned: false,
        archived: false,
        status: "idle",
        // 原生时间未知使用目录的0哨兵，不把导入时刻伪装成旧会话活动时间。
        updatedAt: Number.isFinite(date) ? date / 1000 : 0,
      };
      // 共享仓储 task.put 是 INSERT ... ON CONFLICT DO NOTHING，重试不会覆盖用户修改。
      await store.catalog("task.put", task);
      known.add(session.sessionId);
    }
    cursor = page.nextCursor ?? undefined;
    if (cursor) {
      if (cursors.has(cursor) || cursors.size >= 10_000) throw new Error("ACP 历史目录分页无进展");
      cursors.add(cursor);
    }
  } while (cursor);
}
