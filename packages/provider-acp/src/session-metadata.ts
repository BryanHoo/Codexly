import { projectAcpConfig } from "./session-options.js";
import type {
  AvailableCommand,
  SessionNotification,
  InitializeResponse,
} from "@agentclientprotocol/sdk/unstable";
import type { AcpConfigOption, AgentContextUsage } from "@codexly/protocol";
import type { AcpSessionState } from "@codexly/protocol";
import { acpContextUsage } from "./context-usage.js";

export type AcpSessionMetadata = AcpSessionState;

interface Entry {
  value: AcpSessionMetadata;
  json: string;
  bytes: number;
  usage: AgentContextUsage | null;
}

/** 保存 ACP 会话元数据；允许创建响应前的命令更新，不为聊天 token 分配缓存。 */
export class AcpSessionMetadataStore {
  static supportsSteering({ agentInfo, _meta }: InitializeResponse): boolean {
    const steering = _meta?.["steering"];
    // 引导是适配器显式协商的扩展，稳定 v1 核心不依赖它。
    const version = /^(\d+)\.(\d+)\.\d+$/u.exec(agentInfo?.version ?? "");
    return (
      agentInfo?.name === "@agentclientprotocol/codex-acp" &&
      version !== null &&
      (Number(version[1]) > 2 || (Number(version[1]) === 2 && Number(version[2]) >= 8)) &&
      typeof steering === "object" &&
      steering !== null &&
      "supported" in steering &&
      steering.supported === true
    );
  }

  readonly #entries = new Map<string, Entry>();
  #bytes = 0;

  read(sessionId: string): AcpSessionMetadata {
    return structuredClone(
      this.#entries.get(sessionId)?.value ?? { configOptions: [], availableCommands: [] },
    );
  }
  hasBackgroundWork(sessionId?: string): boolean {
    if (sessionId !== undefined) return !!this.#entries.get(sessionId)?.value.background?.length;
    for (const { value } of this.#entries.values()) if (value.background?.length) return true;
    return false;
  }
  readUsage(sessionId: string): AgentContextUsage | null {
    const usage = this.#entries.get(sessionId)?.usage;
    return usage ? { ...usage } : null;
  }
  foreground(sessionId: string, foreground: "running" | "idle") {
    return this.#write(sessionId, { ...this.read(sessionId), foreground });
  }
  configure(sessionId: string, configOptions: AcpConfigOption[], commands?: AvailableCommand[]) {
    return this.#write(sessionId, {
      ...this.read(sessionId),
      configOptions,
      availableCommands: commands
        ? this.#commands(commands)
        : (this.#entries.get(sessionId)?.value.availableCommands ?? []),
    });
  }
  update({ sessionId, update }: SessionNotification): AcpSessionMetadata | undefined {
    if (update.sessionUpdate === "usage_update") {
      // 用量与会话共用容量及清理边界，创建/加载响应前也可缓存；回合结束后继续保留。
      if (!this.#entries.has(sessionId))
        this.#write(sessionId, { configOptions: [], availableCommands: [] });
      const entry = this.#entries.get(sessionId);
      if (entry) entry.usage = acpContextUsage(update);
      return undefined;
    }
    if (update.sessionUpdate === "config_option_update")
      return this.configure(sessionId, projectAcpConfig(update.configOptions));
    if (update.sessionUpdate === "session_info_update") {
      const { updatedAt } = update;
      if (updatedAt === undefined) return undefined;
      // 会话通知只同步活动时间，应用标题由自身生成和用户手动保存。
      return this.#write(sessionId, {
        ...this.read(sessionId),
        updatedAt: updatedAt === null ? null : updatedAt.slice(0, 16384),
      });
    }
    if (update.sessionUpdate !== "available_commands_update") return undefined;
    return this.#write(sessionId, {
      ...this.read(sessionId),
      availableCommands: this.#commands(update.availableCommands),
    });
  }
  #commands(commands: AvailableCommand[]): AcpSessionMetadata["availableCommands"] {
    return commands.flatMap((command): AcpSessionMetadata["availableCommands"] => {
      const { name, description, input, _meta } = command;
      return [
        {
          name,
          description,
          ...(input ? { input: { hint: input.hint } } : {}),
          ...(_meta === undefined ? {} : { _meta }),
        },
      ];
    });
  }
  #write(sessionId: string, value: AcpSessionMetadata): AcpSessionMetadata | undefined {
    const previous = this.#entries.get(sessionId),
      json = JSON.stringify(value);
    if (previous?.json === json) return undefined;
    if (
      !sessionId ||
      Buffer.byteLength(sessionId) > 1024 ||
      (!previous && this.#entries.size >= 128)
    )
      throw new Error("ACP 会话元数据达到容量限制");
    const bytes = Buffer.byteLength(json),
      total = this.#bytes - (previous?.bytes ?? 0) + bytes;
    // 单事件留在公共传输预算以内，总缓存独立限流，不能随会话或模型目录无限增长。
    if (bytes > 256 * 1024 || total > 4 * 1024 * 1024)
      throw new Error("ACP 会话元数据超过字节预算");
    const copy = structuredClone(value);
    this.#entries.set(sessionId, { value: copy, json, bytes, usage: previous?.usage ?? null });
    this.#bytes = total;
    return structuredClone(copy);
  }
  delete(sessionId: string): void {
    const previous = this.#entries.get(sessionId);
    if (previous) this.#bytes -= previous.bytes;
    this.#entries.delete(sessionId);
  }
  retain(sessionIds: ReadonlySet<string>): void {
    for (const id of this.#entries.keys()) if (!sessionIds.has(id)) this.delete(id);
  }
  *disconnected(): IterableIterator<[string, AcpSessionMetadata]> {
    for (const [id, { value }] of this.#entries) {
      if (
        value.foreground === "running" ||
        value.foreground === "requires_action" ||
        value.background?.length
      ) {
        const { background: _background, ...state } = value;
        yield [id, { ...state, foreground: "unknown" }];
      }
    }
  }
  clear(): void {
    this.#entries.clear();
    this.#bytes = 0;
  }
}
