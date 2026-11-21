import { projectAcpConfig } from "./session-options.js";
import {
  AvailableCommand,
  AvailableCommandInput,
  BackgroundWork,
  StateUpdate,
  SessionUpdate,
  type UpdateSessionNotification,
  type InitializeResponse,
} from "@agentclientprotocol/sdk/experimental/v2/unstable";
import type { AcpConfigOption, AgentContextUsage } from "@codexly/protocol";
import type { AcpSessionState } from "@codexly/protocol";
import { acpContextUsage } from "./context-usage.js";

export type AcpSessionMetadata = AcpSessionState;
type Work = NonNullable<AcpSessionMetadata["background"]>[number];
const WORK_LIMIT = 128;

interface ActivityEntity {
  label?: string;
  cancellable: boolean;
  status?: string;
  exited?: boolean;
}

interface Entry {
  value: AcpSessionMetadata;
  json: string;
  bytes: number;
  usage: AgentContextUsage | null;
}

/** 保存 ACP 会话元数据；允许创建响应前的命令更新，不为聊天 token 分配缓存。 */
export class AcpSessionMetadataStore {
  static supportsSteering({ info, _meta }: InitializeResponse): boolean {
    const steering = _meta?.["steering"];
    // 扩展旗标本身不承诺空闲回退行为，只启用已支持 promptRequired 的适配器版本。
    const version = /^(\d+)\.(\d+)\.\d+$/u.exec(info.version);
    return (
      info.name === "@agentclientprotocol/codex-acp" &&
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
  readonly #entities = new Map<string, Map<string, ActivityEntity>>();

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
  confirmPrompt(sessionId: string, turnId: string, messageId: string) {
    return this.#write(sessionId, {
      ...this.read(sessionId),
      promptReceipt: { turnId, messageId },
    });
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
  update({ sessionId, update }: UpdateSessionNotification): AcpSessionMetadata | undefined {
    if (SessionUpdate.isStateUpdate(update)) {
      const current = this.read(sessionId);
      const { background: _previous, ...state } = current;
      const known =
        StateUpdate.isIdle(update) ||
        StateUpdate.isRunning(update) ||
        StateUpdate.isRequiresAction(update) ||
        StateUpdate.isUnknown(update);
      const background = known ? update.background : undefined;
      return this.#write(sessionId, {
        ...state,
        foreground: known ? update.state : "unknown",
        ...(background
          ? {
              background: background.slice(0, WORK_LIMIT).map((work, index) => {
                if (BackgroundWork.isTerminal(work))
                  return this.#work(sessionId, "terminal", work.terminalId);
                if (BackgroundWork.isToolCall(work))
                  return this.#work(sessionId, "tool_call", work.toolCallId);
                if (BackgroundWork.isSubagent(work))
                  return this.#work(sessionId, "subagent", work.sessionId);
                return { kind: "unknown" as const, id: String(index), cancellable: false };
              }),
            }
          : {}),
      });
    }
    if (
      SessionUpdate.isTerminalUpdate(update) ||
      SessionUpdate.isToolCallUpdate(update) ||
      SessionUpdate.isSubagentUpdate(update)
    )
      return this.#trackEntity(sessionId, update);
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
      ...this.read(sessionId),
      availableCommands: this.#commands(update.availableCommands),
    });
  }
  #trackEntity(
    sessionId: string,
    update: Extract<
      UpdateSessionNotification["update"],
      { sessionUpdate: "terminal_update" | "tool_call_update" | "subagent_update" }
    >,
  ) {
    let kind: Work["kind"];
    let id: string;
    let label: string | null | undefined;
    let cancellable: boolean | undefined;
    let status: string | undefined;
    let exited: boolean | undefined;
    if (SessionUpdate.isTerminalUpdate(update)) {
      kind = "terminal";
      id = update.terminalId;
      label = update.command;
      if (update.capabilities !== undefined) cancellable = !!update.capabilities?.cancel;
      if (update.exitStatus !== undefined) exited = update.exitStatus !== null;
    } else if (SessionUpdate.isToolCallUpdate(update)) {
      kind = "tool_call";
      id = update.toolCallId;
      label = update.title === undefined ? update.name : update.title;
      if (update.capabilities !== undefined) cancellable = !!update.capabilities?.cancel;
      if (update.status !== undefined) status = update.status ?? "pending";
    } else {
      kind = "subagent";
      id = update.sessionId;
      label = update.title;
    }
    if (!id || id.length > 1024) return undefined;
    let entities = this.#entities.get(sessionId);
    if (!entities) {
      if (this.#entities.size >= 128) return undefined;
      entities = new Map();
      this.#entities.set(sessionId, entities);
    }
    const key = `${kind}:${id}`;
    const old = entities.get(key);
    const background = this.#entries.get(sessionId)?.value.background;
    if (!old && entities.size >= WORK_LIMIT) {
      // 优先淘汰未列入当前后台清单的旧实体，给长会话的更新留出空间。
      const disposable = [...entities.keys()].find(
        (entry) => !background?.some((work) => entry === `${work.kind}:${work.id}`),
      );
      if (disposable === undefined) return undefined;
      entities.delete(disposable);
    }
    const title = label === undefined ? old?.label : label?.slice(0, 512);
    const currentStatus = status ?? old?.status;
    const hasExited = exited ?? old?.exited;
    entities.set(key, {
      ...(title ? { label: title } : {}),
      cancellable: cancellable ?? old?.cancellable ?? false,
      ...(currentStatus !== undefined ? { status: currentStatus } : {}),
      ...(hasExited !== undefined ? { exited: hasExited } : {}),
    });
    if (!background?.some((work) => work.kind === kind && work.id === id)) return undefined;
    return this.#write(sessionId, {
      ...this.read(sessionId),
      background: background.map((work) =>
        work.kind === kind && work.id === id ? this.#work(sessionId, kind, id) : work,
      ),
    });
  }

  #work(sessionId: string, kind: Work["kind"], id: string): Work {
    if (!id || id.length > 1024) return { kind: "unknown", id: "unavailable", cancellable: false };
    const entity = this.#entities.get(sessionId)?.get(`${kind}:${id}`);
    return {
      kind,
      id,
      ...(entity?.label ? { label: entity.label } : {}),
      ...(entity?.status === "paused" ? { paused: true } : {}),
      cancellable:
        entity?.cancellable === true &&
        !entity.exited &&
        entity.status !== "completed" &&
        entity.status !== "failed" &&
        entity.status !== "cancelled",
    };
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
    this.#entities.delete(sessionId);
  }
  retain(sessionIds: ReadonlySet<string>): void {
    for (const id of this.#entries.keys()) if (!sessionIds.has(id)) this.delete(id);
    for (const id of this.#entities.keys()) if (!sessionIds.has(id)) this.#entities.delete(id);
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
    this.#entities.clear();
    this.#bytes = 0;
  }
}
