import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep, win32 } from "node:path";
import type { LocalCatalogStore, LocalProject, LocalTask } from "@codexly/core";
import type { Project } from "@codexly/protocol";
import type { CodexRpcClient } from "./codex-rpc-client.js";
import {
  expectRecord,
  expectString,
  CODEX_PINNED_THREAD_SECTION_ID,
} from "./codex-protocol-mapping.js";

/** 仓储保存可直接访问的磁盘路径，比较键不能作为路径写回数据库或公共协议。 */
async function canonicalFolderPath(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}

function pathKey(path: string): string {
  return process.platform === "win32" ? path.toLocaleLowerCase("en-US") : path;
}

async function repairImportedPaths(client: CodexRpcClient, store: LocalCatalogStore) {
  if (process.platform === "win32") return;
  const invalid = (await store.catalog("project.list", undefined)).filter(
    (project) => !isAbsolute(project.path) && project.path.startsWith("\\"),
  );
  if (invalid.length === 0) return;
  const originalPaths = new Map<string, string>();
  for (const source of await allPages(client, "project/list", {})) {
    for (const root of source["roots"] as { path: string }[]) {
      const path = await canonicalFolderPath(root.path);
      // 仅匹配旧迁移实际生成的错误键；绝不靠替换斜杠猜测已丢失的大小写。
      originalPaths.set(win32.resolve(path).toLocaleLowerCase("en-US"), path);
    }
  }
  for (const project of invalid) {
    const path = originalPaths.get(project.path);
    if (path === undefined)
      throw new Error(`Cannot recover the original folder for project ${project.id}`);
    // 保留应用 ID、名称与关联数据；仓储在同一事务修复目录及兼容设置视图。
    await store.catalog("project.put", { ...project, path });
  }
}

async function allPages(client: CodexRpcClient, method: string, params: Record<string, unknown>) {
  const result: Record<string, unknown>[] = [],
    seen = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const response = expectRecord(
      await client.request(method, { ...params, limit: 100, ...(cursor ? { cursor } : {}) }),
      method,
    );
    if (!Array.isArray(response["data"])) throw new Error(`Invalid ${method} migration page`);
    result.push(...response["data"].map((value) => expectRecord(value, method)));
    if (response["nextCursor"] == null) return result;
    cursor = expectString(response["nextCursor"], "cursor");
    if (seen.has(cursor) || seen.size >= 10000)
      throw new Error("Migration pagination did not advance");
    seen.add(cursor);
  }
}

/** 上游仅在首次导入时读取；不修改其项目、会话、名称或归档状态。 */
export async function importCodexCatalog(
  client: CodexRpcClient,
  store: LocalCatalogStore,
  legacy: readonly Project[],
) {
  if (await store.catalog("migration.done", undefined)) {
    await repairImportedPaths(client, store);
    return;
  }
  const native = (await allPages(client, "project/list", {})).sort(
    (a, b) => Number(a["position"] ?? 0) - Number(b["position"] ?? 0),
  );
  const sources = new Map(legacy.map((project) => [project.id, project]));
  for (const p of native)
    sources.set(expectString(p["id"], "id"), {
      id: expectString(p["id"], "id"),
      name: expectString(p["name"], "name"),
      createdAt: new Date(Number(p["createdAt"]) * 1000).toISOString(),
      roots: (p["roots"] as { path: string }[]).map((root) => ({ id: root.path, path: root.path })),
    });
  const projects: (LocalProject & { sourceId?: string })[] = [],
    byPath = new Map<string, LocalProject>(),
    bySource = new Map<string, LocalProject[]>();
  for (const source of sources.values()) {
    const roots: LocalProject[] = [];
    for (const [index, root] of source.roots.entries()) {
      const path = await canonicalFolderPath(root.path);
      let project = byPath.get(pathKey(path));
      if (!project) {
        project = {
          id:
            index === 0
              ? source.id
              : `${source.id}-${createHash("sha256").update(path).digest("hex").slice(0, 16)}`,
          name: index === 0 ? source.name : basename(path),
          path,
          createdAt: source.createdAt,
        };
        projects.push({ ...project, sourceId: source.id });
        byPath.set(pathKey(path), project);
      }
      roots.push(project);
    }
    bySource.set(source.id, roots);
  }
  const tasks: LocalTask[] = [];
  for (const archived of [false, true]) {
    for (const thread of await allPages(client, "thread/list", { archived, modelProviders: [] })) {
      const cwd = expectString(thread["cwd"], "cwd"),
        path = await canonicalFolderPath(cwd);
      const candidates =
        typeof thread["projectId"] === "string" ? bySource.get(thread["projectId"]) : undefined;
      // 最长路径优先处理嵌套根；worktree 保持原项目，避免误丢失历史。
      const owner =
        candidates
          ?.slice()
          .sort((a, b) => b.path.length - a.path.length)
          .find((p) => {
            const child = relative(p.path, path);
            return (
              child === "" ||
              (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`))
            );
          }) ?? candidates?.[0];
      const id = expectString(thread["id"], "thread id");
      tasks.push({
        id,
        projectId: owner?.id ?? null,
        cwd,
        provider: "codex",
        sessionId: id,
        title:
          typeof thread["name"] === "string" && thread["name"].trim()
            ? thread["name"]
            : typeof thread["preview"] === "string"
              ? (thread["preview"].split(/\r?\n/u)[0] ?? "")
              : "",
        updatedAt: Number(thread["updatedAt"]),
        pinned:
          (thread["section"] as { id?: string } | null)?.id === CODEX_PINNED_THREAD_SECTION_ID,
        archived,
        status: "notLoaded",
      });
    }
  }
  await store.catalog("migration.import", { projects, tasks });
}
