import type { AgentProviderEvent } from "@codexly/core";
import type { AgentItem, AgentTurn } from "@codexly/protocol";
import { matchesMessageIdentity, type IdentityMessage } from "./message-identity-matching.js";

interface Entry {
  message: IdentityMessage;
  aliases: Set<string>;
  live: boolean;
  snapshot: boolean;
  comparable: boolean;
  order: number;
}
interface TurnIdentity {
  taskId: string;
  entries: Map<string, Entry>;
  running: boolean;
}
const MAX_TURNS = 128;
const MAX_MESSAGES = 256;
const MAX_TEXT = 16384;
const MAX_RETAINED_TEXT = 1048576;

/** Provider 会话内共享的身份表。快照、流式事件和所有浏览器使用相同的规范 ID。 */
export class MessageIdentityRegistry {
  readonly #turns = new Map<string, TurnIdentity>();
  #textSize = 0;
  #order = 0;

  private turn(taskId: string, turnId: string): TurnIdentity {
    const key = JSON.stringify([taskId, turnId]);
    const value = this.#turns.get(key) ?? {
      taskId,
      entries: new Map<string, Entry>(),
      running: false,
    };
    this.#turns.delete(key);
    this.#turns.set(key, value);
    if (this.#turns.size > MAX_TURNS) {
      // 加载旧历史时优先淘汰已结束回合，避免正在输出的别名被分页读取挤出。
      const oldest =
        [...this.#turns].find(([candidateKey, turn]) => candidateKey !== key && !turn.running) ??
        this.#turns.entries().next().value;
      if (oldest !== undefined) {
        this.release(oldest[1]);
        this.#turns.delete(oldest[0]);
      }
    }
    return value;
  }
  private find(turn: TurnIdentity, id: string) {
    return (
      turn.entries.get(id) ?? [...turn.entries.values()].find((entry) => entry.aliases.has(id))
    );
  }
  private remember(
    turn: TurnIdentity,
    item: IdentityMessage,
    live: boolean,
    snapshot: boolean,
  ): Entry | undefined {
    let entry = this.find(turn, item.id);
    if (entry === undefined) {
      if (turn.entries.size >= MAX_MESSAGES) return undefined;
      entry = {
        message: { id: item.id, type: "message", role: item.role, text: "" },
        aliases: new Set(),
        live: false,
        snapshot: false,
        comparable: true,
        order: this.#order++,
      };
      turn.entries.set(item.id, entry);
    }
    this.#textSize -= entry.message.text.length;
    entry.comparable =
      item.text.length <= MAX_TEXT && this.#textSize + item.text.length <= MAX_RETAINED_TEXT;
    // 比较预算耗尽时保留 ID 映射，停止内容推断；不截断文本后制造错误匹配。
    const phase = item.phase ?? entry.message.phase;
    entry.message = {
      id: entry.message.id,
      type: "message",
      role: item.role,
      text: entry.comparable ? item.text : "",
      ...(phase === undefined ? {} : { phase }),
      ...(item.attachments === undefined ? {} : { attachments: item.attachments }),
    };
    this.#textSize += entry.message.text.length;
    entry.live ||= live;
    entry.snapshot ||= snapshot;
    return entry;
  }
  private alias(entry: Entry, id: string): boolean {
    if (entry.message.id === id || entry.aliases.has(id)) return true;
    if (entry.aliases.size >= 256) return false;
    entry.aliases.add(id);
    return true;
  }
  private render(item: IdentityMessage, entry: Entry): IdentityMessage {
    return {
      ...item,
      id: entry.message.id,
      ...(entry.aliases.size === 0 ? {} : { identityAliases: [...entry.aliases] }),
    };
  }
  public snapshot(taskId: string, turns: readonly AgentTurn[]): AgentTurn[] {
    return turns.map((turn) => {
      const messages = turn.items.filter(
        (item): item is IdentityMessage => item.type === "message",
      );
      if (messages.length === 0) return turn;
      const state = this.turn(taskId, turn.id);
      state.running = turn.status === "running";
      const matches = new Map<string, Entry>();
      const used = new Set<Entry>();
      for (const item of messages) {
        const known = this.find(state, item.id);
        if (known !== undefined) {
          matches.set(item.id, known);
          used.add(known);
        }
      }
      const candidates = new Map<string, Entry[]>();
      const counts = new Map<Entry, number>();
      for (const item of messages) {
        if (matches.has(item.id)) continue;
        const options = [...state.entries.values()].filter(
          (entry) =>
            entry.live &&
            entry.comparable &&
            !used.has(entry) &&
            matchesMessageIdentity(entry.message, item),
        );
        candidates.set(item.id, options);
        for (const entry of options) counts.set(entry, (counts.get(entry) ?? 0) + 1);
      }
      // 双向唯一匹配，不能贪心地把两个相同文本归并成一个实体。
      for (const [id, options] of candidates) {
        const entry = options.length === 1 ? options[0] : undefined;
        if (entry !== undefined && counts.get(entry) === 1 && this.alias(entry, id))
          matches.set(id, entry);
      }
      return {
        ...turn,
        items: turn.items.map((item): AgentItem => {
          if (item.type !== "message") return item;
          const entry = matches.get(item.id);
          const normalized = entry === undefined ? item : this.render(item, entry);
          this.remember(state, normalized, false, true);
          return normalized;
        }),
      };
    });
  }
  public event(event: AgentProviderEvent): AgentProviderEvent {
    if (event.type === "turn.started" || event.type === "turn.completed") {
      const items = event.payload.turn.items.map((item) =>
        item.type === "message"
          ? this.completed(event.taskId, event.turnId, item, event.payload.turn.items)
          : item,
      );
      this.turn(event.taskId, event.turnId).running = event.type === "turn.started";
      return { ...event, payload: { ...event.payload, turn: { ...event.payload.turn, items } } };
    }
    if (event.type === "item.started" || event.type === "item.completed") {
      if (event.payload.item.type !== "message") return event;
      const item = this.completed(event.taskId, event.turnId, event.payload.item);
      return { ...event, itemId: item.id, payload: { item } };
    }
    if (event.type !== "message.delta") return event;
    const state = this.turn(event.taskId, event.turnId);
    state.running = true;
    const entry = this.find(state, event.itemId);
    const id = entry?.message.id ?? event.itemId;
    if (entry?.comparable !== false)
      this.remember(
        state,
        {
          id,
          type: "message",
          role: "assistant",
          text: (entry?.message.text ?? "") + event.payload.delta,
        },
        true,
        false,
      );
    return id === event.itemId ? event : { ...event, itemId: id };
  }
  private completed(
    taskId: string,
    turnId: string,
    item: IdentityMessage,
    batch: readonly AgentItem[] = [item],
  ): IdentityMessage {
    const state = this.turn(taskId, turnId);
    let entry = this.find(state, item.id);
    if (entry?.snapshot !== true) {
      const candidates = [...state.entries.values()].filter(
        (candidate) =>
          candidate !== entry &&
          candidate.snapshot &&
          !candidate.live &&
          candidate.comparable &&
          matchesMessageIdentity(candidate.message, item) &&
          // 批量终态也要求反向唯一；其他消息已占用或同样匹配时禁止贪心归并。
          !batch.some(
            (other) =>
              other.type === "message" &&
              other.id !== item.id &&
              (this.find(state, other.id) === candidate ||
                matchesMessageIdentity(candidate.message, other)),
          ),
      );
      const candidate = candidates.length === 1 ? candidates[0] : undefined;
      if (candidate !== undefined) {
        const keep = entry !== undefined && entry.order < candidate.order ? entry : candidate;
        const remove = keep === entry ? candidate : entry;
        const aliases = new Set([
          ...keep.aliases,
          item.id,
          ...(remove === undefined ? [] : [remove.message.id, ...remove.aliases]),
        ]);
        aliases.delete(keep.message.id);
        if (aliases.size <= 256) {
          keep.aliases = aliases;
          keep.snapshot = true;
          if (remove !== undefined) {
            state.entries.delete(remove.message.id);
            this.#textSize -= remove.message.text.length;
          }
          entry = keep;
        }
      }
    }
    const normalized = entry === undefined ? item : this.render(item, entry);
    this.remember(state, normalized, true, false);
    return normalized;
  }
  private release(turn: TurnIdentity) {
    for (const entry of turn.entries.values()) this.#textSize -= entry.message.text.length;
  }
  public clearTask(taskId: string): void {
    for (const [key, turn] of this.#turns)
      if (turn.taskId === taskId) {
        this.release(turn);
        this.#turns.delete(key);
      }
  }
  public clear(): void {
    this.#turns.clear();
    this.#textSize = 0;
  }
}
