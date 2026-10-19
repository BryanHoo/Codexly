import type { AgentItem } from "@codexly/protocol";

/** 首屏用户正文有独立预算；始终保留原问题和最近引导，完整输入仍在过程分页中。 */
export class ClaudeSummaryUsers {
  readonly items: AgentItem[] = [];
  #bytes = 0;
  constructor(readonly budget: number) {}
  add(item: AgentItem): void {
    if (item.type !== "message" || item.role !== "user") return;
    const bytes = Buffer.byteLength(JSON.stringify(item));
    while (
      this.items.length > 1 &&
      (this.items.length >= 64 || this.#bytes + bytes > this.budget)
    ) {
      const removed = this.items.splice(1, 1)[0];
      if (removed) this.#bytes -= Buffer.byteLength(JSON.stringify(removed));
    }
    if (!this.items.length || this.#bytes + bytes <= this.budget) {
      this.items.push(item);
      this.#bytes += bytes;
    }
  }
}
