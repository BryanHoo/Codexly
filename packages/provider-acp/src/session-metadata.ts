import { projectAcpConfig } from "./session-options.js";
import {
  AvailableCommand,
  AvailableCommandInput,
  SessionUpdate,
  type UpdateSessionNotification,
} from "@agentclientprotocol/sdk/experimental/v2/unstable";
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
  readonly #entries = new Map<string, Entry>();
  #bytes = 0;

  read(sessionId: string): AcpSessionMetadata {
    return structuredClone(
      this.#entries.get(sessionId)?.value ?? { configOptions: [], availableCommands: [] },
    );
  }
  readUsage(sessionId: string): AgentContextUsage | null {
    const usage = this.#entries.get(sessionId)?.usage;
    return usage ? { ...usage } : null;
  }
  configure(sessionId: string, configOptions: AcpConfigOption[], commands?: AvailableCommand[]) {
    return this.#write(sessionId, {
      configOptions,
      availableCommands: commands
        ? this.#commands(commands)
        : (this.#entries.get(sessionId)?.value.availableCommands ?? []),
    });
  }
  update({ sessionId, update }: UpdateSessionNotification): AcpSessionMetadata | undefined {
    if (SessionUpdate.isUsageUpdate(update)) {
      // 用量与会话共用容量及清理边界，创建/加载响应前也可缓存；回合结束后继续保留。
      if (!this.#entries.has(sessionId))
        this.#write(sessionId, { configOptions: [], availableCommands: [] });
      const entry = this.#entries.get(sessionId);
      if (entry) entry.usage = acpContextUsage(update);
      return undefined;
    }
    if (SessionUpdate.isConfigOptionUpdate(update))
      return this.configure(sessionId, projectAcpConfig(update.configOptions));
    if (!SessionUpdate.isAvailableCommandsUpdate(update)) return undefined;
    return this.#write(sessionId, {
      configOptions: this.#entries.get(sessionId)?.value.configOptions ?? [],
      availableCommands: this.#commands(update.availableCommands),
    });
  }
  #commands(commands: AvailableCommand[]): AcpSessionMetadata["availableCommands"] {
    return commands.flatMap((command): AcpSessionMetadata["availableCommands"] => {
      if (!AvailableCommand.isCommand(command)) return [];
      const { name, description, input, _meta } = command;
      return [
        {
          name,
          description,
          ...(input && AvailableCommandInput.isText(input) ? { input: { hint: input.hint } } : {}),
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
  clear(): void {
    this.#entries.clear();
    this.#bytes = 0;
  }
}
