import { randomUUID } from "node:crypto";
import type { LocalTask } from "@codexly/core";
import type { AgentMcpServerPage } from "@codexly/protocol";
import type { ClaudeConfiguration } from "./config.js";
import { observe } from "./observability.js";
import * as session from "./session.js";
import {
  refreshClaudeMcpSnapshot,
  reconnectClaudeMcpServers,
  type ClaudeMcpAction,
} from "./mcp.js";

/** 管理控制查询的资源与同会话重建；运行会话和启动锁仍由 Provider 唯一持有。 */
export class ClaudeMcpManagement {
  readonly controllers = new Set<AbortController>();
  constructor(
    readonly config: ClaudeConfiguration,
    readonly sdk: session.ClaudeSdk,
    readonly starting: Set<string>,
    readonly running: Map<string, session.Running>,
    readonly readTask: (id: string) => Promise<LocalTask>,
  ) {}
  async listMcpServers(id: string): Promise<AgentMcpServerPage> {
    await this.readTask(id);
    const running = this.running.get(id);
    const live =
      running &&
      (await refreshClaudeMcpSnapshot(
        running.query,
        running.projection,
        () => !running.closed && this.running.get(id) === running,
      ));
    if (live) await this.config.history.saveMetadata(id, running.projection.metadata());
    const snapshot = running?.projection ?? (await this.config.history.metadata(id));
    return {
      data: snapshot?.mcpServers ?? [],
      statusSource: live ? "live" : "cached",
      observedAt: snapshot?.mcpObservedAt ?? null,
    };
  }
  async reloadMcpServers(
    id: string,
    action: ClaudeMcpAction = "reload",
  ): Promise<AgentMcpServerPage> {
    const task = await this.readTask(id);
    if (this.starting.has(id)) throw new Error("MCP 操作或会话正在启动，请稍后重试");
    if (this.config.persistence.hasPending(id))
      throw new Error("Claude 历史持久化尚未完成，请修复存储后刷新 MCP");
    const running = this.running.get(id);
    if (action === "reload" && running && (running.settling || session.hasWork(running)))
      throw new Error("请等待前台、后台任务及定时唤醒结束后重新加载 MCP 配置");
    if (!running && this.starting.size + this.running.size >= 8)
      throw new Error("Claude MCP 查询并发已达上限，请稍后重试");
    // 与发送回合共用启动锁；控制请求期间暂停空闲回收，避免查询在读取途中关闭。
    this.starting.add(id);
    clearTimeout(running?.idleTimer);
    if (running) running.idleTimer = undefined;
    try {
      if (running && !running.closed && action !== "reload") {
        if (action === "reconnect") await reconnectClaudeMcpServers(running.query);
        const response = await this.listMcpServers(id);
        if (response.statusSource !== "live") throw new Error("MCP 状态刷新失败，已保留缓存");
        return response;
      }
      // setMcpServers 无法更新配置文件中的服务；仅在无工作边界关闭旧进程，
      // 以原生会话 ID 恢复一个不发送提示词的临时 Query，让 SDK 重新解析全部配置。
      if (running) {
        session.stop(running);
        await running.done;
      }
      const metadata = await this.config.history.metadata(id);
      const resume = await session.canResume(task, this.sdk, this.config.history, metadata);
      const defaults = await this.config.readSettings();
      const controller = new AbortController(),
        input = session.createInput();
      this.controllers.add(controller);
      let query: ReturnType<session.ClaudeSdk["query"]> | undefined;
      try {
        query = this.sdk.query({
          prompt: input,
          options: {
            cwd: task.cwd,
            env: this.config.environment(),
            abortController: controller,
            settingSources: defaults.loadProjectSettings ? ["user", "project", "local"] : ["user"],
            ...(resume && task.sessionId
              ? { resume: task.sessionId }
              : { sessionId: task.sessionId ?? randomUUID() }),
            // 状态探测不得执行工具，也不能绕过两端的审批系统。
            canUseTool: () =>
              Promise.resolve({ behavior: "deny", message: "MCP 状态探测不执行工具" }),
          },
        });
        // 新进程先完成 SDK 初始化；实时状态读取仍沿用短时观察预算。
        const probe = query;
        if (!(await observe(() => probe.initializationResult(), 15_000)))
          throw new Error("MCP 会话初始化失败或超时，已保留缓存");
        if (action === "reconnect") await reconnectClaudeMcpServers(query);
        const snapshot = {
          mcpServers: metadata?.mcpServers ?? [],
          mcpObservedAt: metadata?.mcpObservedAt ?? null,
        };
        if (!(await refreshClaudeMcpSnapshot(query, snapshot, () => !controller.signal.aborted)))
          throw new Error("MCP 状态刷新失败，已保留缓存");
        await this.config.history.saveMetadata(id, {
          sessionInitialized: false,
          contextUsage: null,
          plan: null,
          model: null,
          ...metadata,
          ...snapshot,
        });
        return {
          data: snapshot.mcpServers,
          observedAt: snapshot.mcpObservedAt,
          statusSource: "live",
        };
      } finally {
        controller.abort();
        input.close();
        this.controllers.delete(controller);
        try {
          query?.close();
        } catch {
          /* 进程已经退出时仍须完成资源回收。 */
        }
      }
    } finally {
      this.starting.delete(id);
      const current = this.running.get(id);
      if (current) session.scheduleIdle(current, current.idleTimeoutMs);
    }
  }
  close(): void {
    for (const controller of this.controllers) controller.abort();
  }
}
