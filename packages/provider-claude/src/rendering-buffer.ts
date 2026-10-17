import type { AgentItem, AgentTurn } from "@codexly/protocol";

// 为事件信封及终态错误预留空间，整回合必须小于公共协议的 512 KiB 单帧限制。
export const CLAUDE_TURN_PREVIEW_BYTES = 384 * 1024;
export const CLAUDE_CHILD_PREVIEW_BYTES = 64 * 1024;
export const CLAUDE_PREVIEW_NOTICE = "\n[展示已省略部分内容，完整记录保留在 Claude 会话中]\n";
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** 按序列化字节截取首尾，兼容中文、Emoji 和控制字符；绝不切断 UTF-8 码点。 */
export function previewText(value: string, budget: number): string {
  if (value.length <= budget && size(value) <= budget) return value;
  const half = Math.max(0, Math.floor((budget - size(CLAUDE_PREVIEW_NOTICE) - 8) / 2));
  const fit = (part: string, tail: boolean): string => {
    let low = 0,
      high = Math.min(part.length, half);
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const candidate = tail ? part.slice(-middle) : part.slice(0, middle);
      if (size(candidate) <= half) low = middle;
      else high = middle - 1;
    }
    const candidate = tail ? part.slice(-low || part.length) : part.slice(0, low);
    // UTF-16 的孤立代理码不能随截取进入展示文本。
    return tail
      ? candidate.replace(/^[\uDC00-\uDFFF]/u, "")
      : candidate.replace(/[\uD800-\uDBFF]$/u, "");
  };
  return `${fit(value.slice(0, half), false)}${CLAUDE_PREVIEW_NOTICE}${fit(value.slice(-half), true)}`;
}

function previewValue(value: unknown, budget: number): unknown {
  if (value === undefined) return undefined;
  const json = JSON.stringify(value);
  return Buffer.byteLength(json) <= budget
    ? value
    : previewText(typeof value === "string" ? value : json, budget);
}

function previewInput(value: unknown, budget: number): unknown {
  if (size(value ?? null) <= budget) return value;
  const fields = Object.entries(object(value));
  if (fields.length === 0) return previewValue(value, budget);
  // 保留命令名、文件路径、描述等字段结构，过大的正文只影响各字段的界面预览。
  const preview = Object.fromEntries(
    fields
      .slice(0, 32)
      .map(([key, field]) => [
        key,
        previewValue(field, Math.max(128, Math.floor(budget / (fields.length + 1)))),
      ]),
  );
  return size(preview) <= budget ? preview : previewValue(value, budget);
}

function previewTurn(turn: AgentTurn, budget: number): AgentTurn {
  if (size(turn) <= budget) return turn;
  if (budget < 4096)
    return {
      ...turn,
      items: [
        {
          id: `${turn.id}:preview`,
          type: "activity",
          label: "已省略较早执行记录",
          status: "completed",
        },
      ],
    };
  const buffer = new ClaudeRenderingBuffer(budget, turn.id);
  for (const item of turn.items) buffer.set(item);
  return { ...turn, items: buffer.snapshot() };
}

function previewItem(item: AgentItem, budget: number): AgentItem {
  if (size(item) <= budget) return item;
  if (item.type === "message" || item.type === "plan")
    return { ...item, text: previewText(item.text, budget - 1024) };
  if (item.type === "reasoning")
    return {
      ...item,
      content: previewText(item.content, budget / 3),
      summary: previewText(item.summary, budget / 3),
    };
  if (item.type !== "tool") return item;
  const input = previewInput(item.input, Math.floor(budget / 5));
  const output = object(item.output),
    turn = object(output["turn"]);
  if (item.name === "agent/spawn" && Array.isArray(turn["items"])) {
    // 子代理继续保持可解析的结构，不能把整个 output 转成字符串而丢掉状态和输出入口。
    const agents = Array.isArray(output["agents"])
      ? output["agents"].slice(0, 8).map((value) => {
          const agent = object(value);
          return {
            ...agent,
            ...(typeof agent["nickname"] === "string"
              ? { nickname: previewText(agent["nickname"], 256) }
              : {}),
            ...(typeof agent["message"] === "string"
              ? { message: previewText(agent["message"], 1024) }
              : {}),
          };
        })
      : [];
    return {
      ...item,
      input,
      output: {
        parentTaskId: output["parentTaskId"],
        agents,
        turn: previewTurn(turn as AgentTurn, Math.floor(budget / 2)),
      },
    };
  }
  return {
    ...item,
    input,
    ...(item.output === undefined
      ? {}
      : { output: previewValue(item.output, Math.floor(budget / 2)) }),
  };
}

/** 展示缓存只保留有界首尾预览和最近记录；它的容量不能决定 SDK 的执行成败。 */
export class ClaudeRenderingBuffer {
  readonly #items = new Map<string, AgentItem>();
  readonly #sizes = new Map<string, number>();
  readonly #truncatedText = new Set<string>();
  #bytes = 0;
  #omitted = 0;
  constructor(
    readonly budget = CLAUDE_TURN_PREVIEW_BYTES,
    readonly turnId = "turn",
    readonly paginated = false,
  ) {}
  get(id: string) {
    return this.#items.get(id);
  }
  has(id: string) {
    return this.#items.has(id);
  }
  values() {
    return this.#items.values();
  }
  set(item: AgentItem): AgentItem {
    const projected = previewItem(item, Math.min(128 * 1024, Math.floor(this.budget / 2)));
    const bytes = size(projected);
    this.#bytes += bytes - (this.#sizes.get(item.id) ?? 0);
    this.#items.set(item.id, projected);
    this.#sizes.set(item.id, bytes);
    this.#truncatedText.delete(item.id);
    this.#trim(item.id);
    return projected;
  }
  /** 正常增量只统计本次 Chunk，不重复序列化或扫描稳定的正文前缀。 */
  appendText(id: string, addition: string): { item: AgentItem; delta: string | null } | undefined {
    const item = this.#items.get(id);
    if (
      !item ||
      this.#truncatedText.has(id) ||
      (item.type !== "message" && item.type !== "reasoning")
    )
      return undefined;
    const next =
      item.type === "message"
        ? { ...item, text: item.text + addition }
        : { ...item, content: item.content + addition };
    const bytes = (this.#sizes.get(id) ?? 0) + size(addition) - 2;
    if (bytes > Math.min(128 * 1024, Math.floor(this.budget / 2))) {
      const preview = this.set(next);
      this.#truncatedText.add(id);
      return { item: preview, delta: null };
    }
    this.#bytes += bytes - (this.#sizes.get(id) ?? 0);
    this.#sizes.set(id, bytes);
    this.#items.set(id, next);
    this.#trim(id);
    return { item: next, delta: addition };
  }
  #trim(currentId: string): void {
    while (this.#bytes > this.budget - 2048 || this.#items.size > 512) {
      // 优先移除已结束的过程，尽量保留当前工具和用户输入。
      let removable = [...this.#items.values()].find(
        (entry) =>
          entry.id !== currentId &&
          !(entry.type === "message" && entry.role === "user") &&
          !(entry.type === "tool" && (entry.status === "running" || entry.name === "agent/spawn")),
      );
      if (!removable) {
        // 多个子代理并发时优先缩短旧正文，保留每个代理的身份、状态和输出入口。
        const candidate = [...this.#items.values()].find(
          (entry) =>
            entry.id !== currentId &&
            entry.type === "tool" &&
            (entry.status === "running" || entry.name === "agent/spawn") &&
            (this.#sizes.get(entry.id) ?? 0) > 2048,
        );
        if (candidate) {
          const compact = previewItem(candidate, 2048),
            compactBytes = size(compact);
          if (compactBytes < (this.#sizes.get(candidate.id) ?? 0)) {
            this.#bytes += compactBytes - (this.#sizes.get(candidate.id) ?? 0);
            this.#items.set(candidate.id, compact);
            this.#sizes.set(candidate.id, compactBytes);
            this.#omitted++;
            continue;
          }
        }
        removable = [...this.#items.values()].find((entry) => entry.id !== currentId);
      }
      if (!removable) break;
      this.#bytes -= this.#sizes.get(removable.id) ?? 0;
      this.#items.delete(removable.id);
      this.#sizes.delete(removable.id);
      this.#truncatedText.delete(removable.id);
      this.#omitted++;
    }
  }
  snapshot(): AgentItem[] {
    const items = [...this.#items.values()];
    if (this.#omitted && !this.paginated)
      items.unshift({
        id: `${this.turnId}:rendering-omitted`,
        type: "activity",
        label: "已省略较早执行记录",
        detail: "展示缓存只保留最近记录，完整执行记录仍由 Claude 管理。",
        status: "completed",
      });
    return items;
  }
}
