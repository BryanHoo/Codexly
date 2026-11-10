import type {
  AvailableCommand,
  SessionConfigOption,
  SessionNotification,
} from "@agentclientprotocol/sdk/unstable";

export interface AcpSessionMetadata {
  configOptions: SessionConfigOption[];
  availableCommands: AvailableCommand[];
}
interface Entry {
  value: AcpSessionMetadata;
  json: string;
  bytes: number;
}

/** 保存 ACP 会话元数据；允许创建响应前的命令更新，不为聊天 token 分配缓存。 */
export class AcpSessionMetadataStore {
  readonly #entries = new Map<string, Entry>();
  #bytes = 0;

  read(sessionId: string): AcpSessionMetadata {
    return structuredClone(
      this.#entries.get(sessionId)?.value ?? { configOptions: [], availableCommands: [] },
    );
  }
  configure(sessionId: string, configOptions: SessionConfigOption[]) {
    return this.#write(sessionId, {
      configOptions,
      availableCommands: this.#entries.get(sessionId)?.value.availableCommands ?? [],
    });
  }
  update({ sessionId, update }: SessionNotification): AcpSessionMetadata | undefined {
    if (update.sessionUpdate === "config_option_update")
      return this.configure(sessionId, update.configOptions);
    if (update.sessionUpdate !== "available_commands_update") return undefined;
    return this.#write(sessionId, {
      configOptions: this.#entries.get(sessionId)?.value.configOptions ?? [],
      availableCommands: update.availableCommands,
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
    this.#entries.set(sessionId, { value: copy, json, bytes });
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
  clear(): void {
    this.#entries.clear();
    this.#bytes = 0;
  }
}
