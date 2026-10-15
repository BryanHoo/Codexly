import { randomUUID } from "node:crypto";
import type { LocalCatalogStore, LocalTask } from "@codexly/core";
import type { CodexRpcClient } from "./codex-rpc-client.js";
import { DEFAULT_PROVIDER_LOGGER } from "./agent-provider-logger.js";
import { RpcResponseError } from "./jsonl-rpc-errors.js";
import {
  expectRecord,
  expectString,
  CODEX_PINNED_THREAD_SECTION_ID,
  CODEX_THREAD_CONFIG,
} from "./codex-protocol-mapping.js";

/** 只翻译协议身份字段，绝不替换正文、回合 ID 或工具参数中的普通字符串。 */
export function translateTaskReferences(
  value: unknown,
  ids: ReadonlyMap<string, string>,
  key = "",
): unknown {
  if (Array.isArray(value))
    return value.map((item) =>
      typeof item === "string"
        ? /thread|receiver/i.test(key)
          ? (ids.get(item) ?? item)
          : item
        : translateTaskReferences(item, ids),
    );
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record).map(([field, item]) => {
      const reference =
        /^(threadId|thread_id|parentThreadId|reviewThreadId|agentThreadId|senderThreadId|receiverThreadId)$/u.test(
          field,
        ) ||
        (field === "id" && (key === "thread" || "cwd" in record));
      return [
        field,
        typeof item === "string"
          ? reference
            ? (ids.get(item) ?? item)
            : item
          : translateTaskReferences(item, ids, field),
      ];
    }),
  );
}

export function localTaskThread(
  task: LocalTask,
  native: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...native,
    model: native["model"] ?? null,
    reasoningEffort: native["reasoningEffort"] ?? null,
    id: task.id,
    projectId: task.projectId,
    cwd: task.cwd,
    name: task.title || null,
    preview: task.title,
    updatedAt: Math.floor(task.updatedAt),
    createdAt: native["createdAt"] ?? Math.floor(task.updatedAt),
    status: native["status"] ?? { type: task.status },
    section: task.pinned
      ? { id: CODEX_PINNED_THREAD_SECTION_ID, name: "Pinned", appearance: null }
      : null,
  };
}

export async function createLocalCatalogClient(
  raw: CodexRpcClient,
  store: LocalCatalogStore,
): Promise<CodexRpcClient> {
  const toNative = new Map<string, string>(),
    toLocal = new Map<string, string>();
  const remember = (task: LocalTask) => {
    if (task.provider === "codex" && task.sessionId !== null) {
      toNative.set(task.id, task.sessionId);
      toLocal.set(task.sessionId, task.id);
    }
  };
  for (const task of await store.catalog("task.bindings", undefined)) remember(task);
  const listeners = new Set<Parameters<CodexRpcClient["onNotification"]>[0]>();
  const publish = (method: string, params: unknown) => {
    for (const listener of listeners) listener({ method, params });
  };
  raw.onNotification(({ method, params }) => {
    // 管理状态由应用独占；其他 Codex 客户端的修改不能覆盖本地名称和归档状态。
    if (
      ["thread/name/updated", "thread/archived", "thread/unarchived", "thread/deleted"].includes(
        method,
      )
    )
      return;
    const translated = translateTaskReferences(params, toLocal);
    publish(method, translated);
    if (method === "thread/status/changed" && translated && typeof translated === "object") {
      const p = translated as Record<string, unknown>;
      if (typeof p["threadId"] === "string" && toNative.has(p["threadId"])) {
        const status = p["status"] as { type?: string } | undefined;
        if (typeof status?.type === "string")
          void store.catalog("task.patch", { id: p["threadId"], status: status.type }).catch(() => {
            DEFAULT_PROVIDER_LOGGER.warn(
              { diagnosticCode: "local_task_status_write_failed" },
              "Failed to persist task status",
            );
          });
      }
    }
  });
  return {
    readLocalTask: (id) => store.catalog("task.read", { id }),
    nativeTaskId: (id) => toNative.get(id) ?? id,
    notify: raw.notify.bind(raw),
    rejectServerRequest: raw.rejectServerRequest.bind(raw),
    respondToServerRequest: raw.respondToServerRequest.bind(raw),
    onNotification(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onServerRequest(listener) {
      return raw.onServerRequest((request) => {
        listener({ ...request, params: translateTaskReferences(request.params, toLocal) });
      });
    },
    async request(method, params, timeout, signal) {
      const p = params === undefined ? {} : expectRecord(params, method);
      if (method === "thread/start" && p["ephemeral"] !== true) {
        const local: LocalTask = {
          id: `task-${randomUUID()}`,
          projectId: typeof p["projectId"] === "string" ? p["projectId"] : null,
          cwd: typeof p["cwd"] === "string" ? p["cwd"] : process.cwd(),
          title: "",
          provider: "codex",
          sessionId: null,
          updatedAt: Date.now() / 1000,
          pinned: false,
          archived: false,
          status: "notLoaded",
        };
        await store.catalog("task.put", local);
        return { thread: { ...localTaskThread(local), historyMode: "paginated", turns: [] } };
      }
      if (method === "thread/list") {
        const page = await store.catalog("task.list", {
          ...(Object.hasOwn(p, "projectId") ? { projectId: p["projectId"] as string | null } : {}),
          archived: p["archived"] === true,
          ...(typeof p["sectionId"] === "string" ? { pinned: true } : {}),
          ...(typeof p["cursor"] === "string" ? { cursor: p["cursor"] } : {}),
          ...(typeof p["limit"] === "number" ? { limit: p["limit"] } : {}),
          ...(typeof p["searchTerm"] === "string" ? { searchTerm: p["searchTerm"] } : {}),
        });
        return { ...page, data: page.data.map((task) => localTaskThread(task)) };
      }
      if (method === "project/read") {
        const project = await store.catalog("project.read", {
          id: expectString(p["projectId"], "projectId"),
        });
        if (!project) throw new Error("Project not found");
        return {
          project: {
            ...project,
            roots: [{ path: project.path }],
            createdAt: Date.parse(project.createdAt) / 1000,
            position: 0,
          },
        };
      }
      const id = typeof p["threadId"] === "string" ? p["threadId"] : undefined;
      let task = id === undefined ? null : await store.catalog("task.read", { id });
      if (task) {
        if (task.provider !== "codex")
          throw new Error(`Task requires the ${task.provider} execution adapter`);
        remember(task);
        if (method === "thread/name/set") {
          const title = expectString(p["name"], "name").trim();
          if (!title) throw new Error("Task title is required");
          await store.catalog("task.patch", { id: task.id, title });
          publish("thread/name/updated", { threadId: task.id, threadName: title });
          return {};
        }
        if (method === "thread/section/move") {
          await store.catalog("task.patch", { id: task.id, pinned: p["sectionId"] !== null });
          return {};
        }
        if (method === "thread/archive" || method === "thread/unarchive") {
          const updated = await store.catalog("task.patch", {
            id: task.id,
            archived: method === "thread/archive",
          });
          if (updated.archived) {
            publish("thread/archived", { threadId: task.id });
            if (task.sessionId !== null)
              void raw
                .request("thread/unsubscribe", { threadId: task.sessionId })
                .catch(() => undefined);
          }
          return updated.archived ? {} : { thread: localTaskThread(updated) };
        }
        if (method === "thread/delete") {
          await store.catalog("task.remove", { id: task.id });
          publish("thread/deleted", { threadId: task.id });
          if (task.sessionId !== null)
            void raw
              .request("thread/unsubscribe", { threadId: task.sessionId })
              .catch(() => undefined);
          toNative.delete(task.id);
          if (task.sessionId) toLocal.delete(task.sessionId);
          return {};
        }
      }
      if (method.startsWith("project/"))
        throw new Error("Project management belongs to the local catalog");
      if (id?.startsWith("task-") && !task) throw new Error("Task not found");
      if (task?.sessionId === null) {
        if (method === "thread/settings/update" && typeof p["cwd"] === "string") {
          await store.catalog("task.patch", { id: task.id, cwd: p["cwd"] });
          return {};
        }
        if (method === "thread/read")
          return { thread: { ...localTaskThread(task), historyMode: "paginated", turns: [] } };
        if (method === "thread/turns/list" || method === "thread/queue/list")
          return { data: [], nextCursor: null };
        if (method === "thread/goal/get") return { goal: null };
        if (method === "thread/unsubscribe") return { status: "notLoaded" };
        // 首次执行时才分配引擎会话；目录和空任务的创建不依赖引擎可用性。
        const started = expectRecord(
          await raw.request(
            "thread/start",
            {
              cwd: task.cwd,
              historyMode: "paginated",
              config: p["config"] ?? CODEX_THREAD_CONFIG,
              runtimeWorkspaceRoots: [task.cwd],
            },
            timeout,
            signal,
          ),
          "thread/start",
        );
        const native = expectRecord(started["thread"], "thread");
        task = await store.catalog("task.patch", {
          id: task.id,
          sessionId: expectString(native["id"], "id"),
        });
        remember(task);
        if (method === "thread/resume")
          return { ...started, thread: localTaskThread(task, native) };
      }
      const nativeParams = expectRecord(translateTaskReferences(p, toNative), "native params");
      if (method === "thread/start" || method === "thread/fork") delete nativeParams["projectId"];
      if (task && method === "turn/start")
        await store.catalog("task.patch", {
          id: task.id,
          updatedAt: Date.now() / 1000,
          status: "active",
        });
      let nativeResponse: unknown;
      try {
        nativeResponse = await raw.request(method, nativeParams, timeout, signal);
      } catch (error) {
        if (task && method === "turn/start")
          await store.catalog("task.patch", { id: task.id, status: task.status });
        // 导入的旧会话可能仍在 Codex 归档区；仅首次恢复执行时解封引擎会话。
        if (
          method !== "thread/resume" ||
          !task ||
          !(error instanceof RpcResponseError) ||
          !error.message.includes(`session ${String(task.sessionId)} is archived`)
        )
          throw error;
        await raw.request("thread/unarchive", { threadId: task.sessionId }, timeout, signal);
        nativeResponse = await raw.request(method, nativeParams, timeout, signal);
      }
      const response = expectRecord(nativeResponse, `${method} response`);
      if (task && method === "thread/settings/update" && typeof p["cwd"] === "string") {
        task = await store.catalog("task.patch", { id: task.id, cwd: p["cwd"] });
      }
      if ((method === "thread/start" || method === "thread/fork") && p["ephemeral"] !== true) {
        const thread = expectRecord(response["thread"], "thread");
        const local: LocalTask = {
          id: `task-${randomUUID()}`,
          projectId:
            task?.projectId ?? (typeof p["projectId"] === "string" ? p["projectId"] : null),
          title: typeof thread["name"] === "string" ? thread["name"] : "",
          cwd: expectString(thread["cwd"], "cwd"),
          provider: "codex",
          sessionId: expectString(thread["id"], "thread id"),
          updatedAt:
            typeof thread["updatedAt"] === "number" ? thread["updatedAt"] : Date.now() / 1000,
          pinned: false,
          archived: false,
          status: "idle",
        };
        await store.catalog("task.put", local);
        remember(local);
        return { ...response, thread: localTaskThread(local, thread) };
      }
      const translated = expectRecord(translateTaskReferences(response, toLocal), "response");
      if (method === "thread/loaded/list" && Array.isArray(translated["data"]))
        translated["data"] = translated["data"].map((id: unknown) =>
          typeof id === "string" ? (toLocal.get(id) ?? id) : id,
        );
      if (method === "thread/search" && Array.isArray(translated["data"])) {
        const mapped = await Promise.all(
          translated["data"].map(async (value) => {
            const entry = expectRecord(value, "search result"),
              thread = expectRecord(entry["thread"], "search thread");
            const local = await store.catalog("task.read", {
              id: expectString(thread["id"], "thread id"),
            });
            return local?.archived === (p["archived"] === true)
              ? { ...entry, thread: localTaskThread(local, thread) }
              : null;
          }),
        );
        translated["data"] = mapped.filter((value) => value !== null);
      }
      if (task && translated["thread"] && typeof translated["thread"] === "object") {
        // RPC 等待期间可能发生本地改名，返回前重读管理字段以免旧快照覆盖新状态。
        const current = await store.catalog("task.read", { id: task.id });
        if (current === null) throw new Error("Task was removed while reading");
        translated["thread"] = localTaskThread(
          current,
          translated["thread"] as Record<string, unknown>,
        );
      }
      return translated;
    },
  };
}
