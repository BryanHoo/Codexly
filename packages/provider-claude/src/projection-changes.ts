import type { AgentItem } from "@codexly/protocol";

/** 版本跟随运行投影；只追踪启用分页的根回合，子代理预览由父工具统一保存。 */
export class ClaudeProjectionChanges {
  readonly #items = new Map<string, AgentItem>();
  #revision = 0;
  constructor(readonly trackItems: boolean) {}
  get revision(): number {
    return this.#revision;
  }
  touch(item?: AgentItem): void {
    this.#revision++;
    if (this.trackItems && item) this.#items.set(item.id, item);
  }
  pendingItems(): AgentItem[] {
    return [...this.#items.values()];
  }
  /** 仅确认本批次对象；保存期间到达的同 ID 新版本继续保持 dirty。 */
  confirmItems(items: readonly AgentItem[]): void {
    for (const item of items) {
      if (this.#items.get(item.id) === item) this.#items.delete(item.id);
    }
  }
}
