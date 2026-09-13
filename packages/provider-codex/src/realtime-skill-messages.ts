import type { AgentProviderEvent } from "@codexly/core";
import type { AgentItem, AgentTurn } from "@codexly/protocol";
import { mergeExpandedSkillMessages, mergeMessageSkills } from "./codex-message-mapping.js";

interface Tail {
  taskId: string;
  item: AgentItem | undefined;
  size: number;
}

/** 仅保留每个回合末尾的用户项，向所有订阅者发布同一份完整 Skill 消息。 */
export class RealtimeSkillMessages {
  readonly #tails = new Map<string, Tail>();
  #size = 0;

  private key(taskId: string, turnId: string): string {
    return JSON.stringify([taskId, turnId]);
  }

  private remove(key: string): void {
    this.#size -= this.#tails.get(key)?.size ?? 0;
    this.#tails.delete(key);
  }

  private remember(taskId: string, turnId: string, item: AgentItem | undefined): void {
    const key = this.key(taskId, turnId);
    this.remove(key);
    let retained = item?.type === "message" && item.role === "user" ? item : undefined;
    let size = retained === undefined ? 0 : JSON.stringify(retained).length;
    // 预算包含正文和元数据；超限时保留独立消息，绝不截断后覆盖用户内容。
    if (size > 65536) {
      retained = undefined;
      size = 0;
    }
    // 空项也是相邻关系的屏障，防止迟到快照重新连回先前的用户消息。
    this.#tails.set(key, { taskId, item: retained, size });
    this.#size += size;
    while (this.#tails.size > 128 || this.#size > 1048576) {
      const oldest = this.#tails.keys().next().value;
      if (oldest === undefined) break;
      this.remove(oldest);
    }
  }

  public seed(taskId: string, turns: readonly AgentTurn[]): void {
    for (const turn of turns) {
      // 旧快照不能覆盖已收到的实时末尾，也不能由历史分页挤出运行中的上下文。
      if (turn.status === "running" && !this.#tails.has(this.key(taskId, turn.id)))
        this.remember(taskId, turn.id, turn.items.at(-1));
    }
  }

  public event(event: AgentProviderEvent): AgentProviderEvent {
    if (event.type === "turn.started") {
      this.remember(event.taskId, event.turnId, event.payload.turn.items.at(-1));
      return event;
    }
    if (event.type === "turn.completed") {
      this.remove(this.key(event.taskId, event.turnId));
      return event;
    }
    if (event.type === "message.delta") {
      this.remember(event.taskId, event.turnId, undefined);
      return event;
    }
    if (event.type !== "item.started" && event.type !== "item.completed") return event;
    const incoming = event.payload.item;
    const previous = this.#tails.get(this.key(event.taskId, event.turnId))?.item;
    const [first, second] =
      previous === undefined ? [incoming] : mergeExpandedSkillMessages([previous, incoming]);
    let item = second ?? first ?? incoming;
    if (
      second !== undefined &&
      previous?.type === "message" &&
      incoming.type === "message" &&
      previous.id === incoming.id &&
      incoming.role === "user" &&
      previous.skills !== undefined
    )
      item = mergeMessageSkills(incoming, previous.skills);
    this.remember(event.taskId, event.turnId, item);
    return item === incoming ? event : { ...event, itemId: item.id, payload: { item } };
  }

  public clearTask(taskId: string): void {
    for (const [key, tail] of this.#tails) if (tail.taskId === taskId) this.remove(key);
  }

  public clear(): void {
    this.#tails.clear();
    this.#size = 0;
  }
}
