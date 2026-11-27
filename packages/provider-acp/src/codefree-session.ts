import type * as acp from "@agentclientprotocol/sdk/unstable";
import { realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { CodefreeServer } from "./codefree-server.js";

export interface NativeSession {
  id: string;
  directory: string;
  projectID?: string;
  title: string;
  time: { updated: number };
  agent?: string;
  model?: { providerID: string; id: string; variant?: string };
  permission?: Rule[];
  metadata?: Record<string, unknown>;
}
/** 恢复和分支前先核对原生会话归属。同一 Git 项目的工作树可以互相恢复。 */
export async function readOwnedSession(server: CodefreeServer, cwd: string, id: string) {
  const source = await server.json<NativeSession>("/session/" + encodeURIComponent(id), cwd);
  const [directory, requested] = await Promise.all([realpath(source.directory), realpath(cwd)]);
  if (directory === requested) return source;
  if (source.projectID && source.projectID !== "global") {
    const project = await server.json<{ id: string }>("/project/current", cwd);
    if (project.id === source.projectID) return source;
  }
  throw new Error("CodeFree O 会话不属于请求的工作目录");
}
interface Rule {
  permission: string;
  pattern: string;
  action: string;
}
const rootsKey = "codexly.acp.additionalDirectories";
const ownedRules = (roots: string[]): Rule[] =>
  roots.map((root) => ({
    permission: "external_directory",
    pattern: join(root, "*"),
    action: "allow",
  }));
/** 只撤销当前适配器加过的目录授权，保留用户规则的覆盖顺序。 */
export function directoryPatch(
  cwd: string,
  roots: readonly string[] = [],
  previous?: NativeSession,
) {
  if (!isAbsolute(cwd) || roots.some((path) => !isAbsolute(path) || /[*?]/.test(path)))
    throw new Error("ACP 工作目录必须为无通配符的绝对路径");
  const next = [...new Set(roots.map((path) => resolve(path)))].filter(
    (path) => path !== resolve(cwd),
  );
  const stored = previous?.metadata?.[rootsKey];
  const old = Array.isArray(stored) ? stored.filter((v): v is string => typeof v === "string") : [];
  if (isDeepStrictEqual(next, old)) return {};
  const prior = [...(previous?.permission ?? [])];
  for (const rule of ownedRules(old)) {
    const index = prior.findIndex((r) => isDeepStrictEqual(r, rule));
    if (index >= 0) prior.splice(index, 1);
  }
  return {
    metadata: { ...previous?.metadata, [rootsKey]: next },
    permission: [...ownedRules(next), ...prior],
  };
}

/** serve 按工作目录注册 MCP；调用方为带私有 MCP 的会话分配独立进程。 */
export async function attachMcp(server: CodefreeServer, cwd: string, entries: acp.McpServer[]) {
  const names = new Set<string>();
  for (const entry of entries) {
    if (names.has(entry.name)) throw new Error("会话 MCP 名称重复");
    names.add(entry.name);
    if ("type" in entry && entry.type !== "http")
      throw new Error("CodeFree O ACP 支持 stdio 和 HTTP MCP");
    const values = (items: { name: string; value: string }[]) =>
      Object.fromEntries(items.map((v) => [v.name, v.value]));
    const config =
      "command" in entry
        ? {
            type: "local",
            command: [entry.command, ...entry.args],
            environment: values(entry.env),
            cwd,
          }
        : { type: "remote", url: entry.url, headers: values(entry.headers) };
    const status = await server.json<Record<string, { status: string }>>("/mcp", cwd, {
      name: entry.name,
      config,
    });
    if (status[entry.name]?.status !== "connected")
      throw new Error("CodeFree O 未连接请求的 MCP 服务");
  }
}
export async function listSessions(server: CodefreeServer, params: acp.ListSessionsRequest) {
  const query = new URLSearchParams({ limit: "100", order: "desc" });
  if (params.cursor) query.set("cursor", params.cursor);
  const page = await server.json<{
    data: {
      id: string;
      location: { directory: string };
      title: string;
      time: { updated: number };
    }[];
    cursor: { next?: string };
  }>("/api/session?" + query.toString(), params.cwd ? await realpath(params.cwd) : "");
  return {
    sessions: page.data.map((s) => ({
      sessionId: s.id,
      cwd: s.location.directory,
      title: s.title,
      updatedAt: new Date(s.time.updated).toISOString(),
    })),
    nextCursor: page.cursor.next ?? null,
  };
}
export interface NativeCommand {
  name: string;
  description?: string;
  hints?: string[];
}
export const commandList = async (server: CodefreeServer, cwd: string) => {
  const commands = await server.json<NativeCommand[]>("/command", cwd);
  return [
    { name: "usage", description: "查询账号的周额度和 5 小时剩余额度" },
    { name: "compact", description: "压缩当前会话上下文" },
    ...commands
      .filter((c) => c.name !== "compact" && c.name !== "usage")
      .map((c) => ({
        name: c.name,
        description: c.description ?? c.name,
        ...(c.hints?.length ? { input: { hint: c.hints.join(" ") } } : {}),
      })),
  ];
};
