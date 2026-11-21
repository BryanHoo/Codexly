import type { HistoricalTaskAttachments } from "@codexly/core/task-attachments";
import type { AgentItem, AgentTurn } from "@codexly/protocol";
import { replayFingerprint } from "./replay-anchor.js";

const TEXT_INLINE = 512 * 1024;
const THOUGHT_INLINE = 64 * 1024;
const TOOL_INLINE = 256 * 1024;
const TOOL_FIELD_INLINE = 16 * 1024;
const ANSWER_OVERFLOW = 12 * 1024 * 1024;
const TOOL_OVERFLOW = 4 * 1024 * 1024;
// 附件仓储按 UTF-8 限制为 1 MiB；按 UTF-16 安全切分，避免拆开代理对。
const ATTACHMENT_CHARS = 256 * 1024;
const OMITTED = "\n\n[内容已达到保留上限]";
const emptyInput = { text: "", files: [], images: [], skills: [] };
type Field = "text" | "input" | "output";
interface Overflow {
  parts: string[];
  bytes: number;
  truncated: boolean;
  structured?: boolean;
}

function prefix(value: string, end: number): string {
  const last = value.charCodeAt(end - 1);
  return value.slice(0, last >= 0xd800 && last <= 0xdbff ? end - 1 : end);
}

/** 快照预算和大正文保留预算分开；只有超出内联的内容才进入任务附件仓储。 */
export class AcpTurnContent {
  readonly #extras = new Map<string, Map<Field, Overflow>>();
  #text = 0;
  #thought = 0;
  #tool = 0;
  #answerBytes = 0;
  #toolBytes = 0;

  text(id: string, delta: string, thought: boolean): string {
    const remaining = thought ? THOUGHT_INLINE - this.#thought : TEXT_INLINE - this.#text;
    const escaped = Buffer.byteLength(JSON.stringify(delta)) - 2;
    const visible =
      escaped <= remaining && !this.#extras.has(id)
        ? delta
        : remaining > 6 && !this.#extras.has(id)
          ? prefix(delta, Math.floor(remaining / 6))
          : "";
    const bytes = visible === delta ? escaped : Buffer.byteLength(JSON.stringify(visible)) - 2;
    if (thought) {
      this.#thought += bytes;
      if (visible !== delta && remaining >= 0) {
        this.#thought = THOUGHT_INLINE + 1;
        return visible + OMITTED;
      }
    } else {
      this.#text += bytes;
      if (visible !== delta) this.#retain(id, "text", delta.slice(visible.length));
    }
    return visible;
  }

  replaceText(id: string, previous: string, value: string, thought: boolean): string {
    const bytes = Buffer.byteLength(JSON.stringify(previous)) - 2;
    if (thought) this.#thought = Math.max(0, this.#thought - bytes);
    else this.#text = Math.max(0, this.#text - bytes);
    const fields = this.#extras.get(id);
    const old = fields?.get("text");
    if (old) {
      this.#answerBytes -= old.bytes;
      fields?.delete("text");
      if (!fields?.size) this.#extras.delete(id);
    }
    return this.text(id, value, thought);
  }

  tool(id: string, field: "input" | "output", value: unknown, previous: unknown): unknown {
    const fields = this.#extras.get(id);
    const old = fields?.get(field);
    if (old) {
      this.#toolBytes -= old.bytes;
      fields?.delete(field);
      if (!fields?.size) this.#extras.delete(id);
    }
    if (previous !== undefined) this.#tool -= Buffer.byteLength(JSON.stringify(previous));
    const json = JSON.stringify(value);
    const bytes = Buffer.byteLength(json);
    if (bytes <= TOOL_FIELD_INLINE && this.#tool + bytes <= TOOL_INLINE) {
      this.#tool += bytes;
      return value;
    }
    const body = typeof value === "string" ? value : json;
    this.#retain(id, field, body).structured = typeof value !== "string";
    const preview = this.#tool + 1_600 <= TOOL_INLINE ? prefix(body, 256) : "";
    const label = preview ? preview + "\n…" : "…";
    this.#tool += Buffer.byteLength(JSON.stringify(label));
    return label;
  }

  #retain(id: string, field: Field, value: string) {
    const fields = this.#extras.get(id) ?? new Map<Field, Overflow>();
    this.#extras.set(id, fields);
    const entry = fields.get(field) ?? { parts: [], bytes: 0, truncated: false };
    fields.set(field, entry);
    if (entry.truncated) return entry;
    const remaining =
      field === "text" ? ANSWER_OVERFLOW - this.#answerBytes : TOOL_OVERFLOW - this.#toolBytes;
    const kept =
      Buffer.byteLength(value) <= remaining ? value : prefix(value, Math.floor(remaining / 4));
    const bytes = Buffer.byteLength(kept);
    if (kept) {
      // 合并小增量，避免把数百万个 token 片段保留成独立数组槽位。
      const index = entry.parts.length - 1;
      const previous = entry.parts[index];
      if (previous !== undefined && previous.length + kept.length <= 64 * 1024)
        entry.parts[index] = previous + kept;
      else entry.parts.push(kept);
    }
    entry.bytes += bytes;
    entry.truncated = kept !== value;
    if (field === "text") this.#answerBytes += bytes;
    else this.#toolBytes += bytes;
    return entry;
  }

  fingerprint(turn: AgentTurn, userText?: string): string {
    if (!this.#extras.size) return replayFingerprint(turn, userText);
    // 用完整的规范投影匹配旧回合，不把预览切点、实时分块或本机附件 ID 算入身份。
    const restore = (entry: Overflow) => {
      const text = entry.parts.join("");
      if (entry.truncated) return text + OMITTED;
      return entry.structured ? (JSON.parse(text) as unknown) : text;
    };
    const items = turn.items.map((item) => {
      const fields = this.#extras.get(item.id);
      if (!fields) return item;
      if (item.type === "message") {
        const text = fields.get("text");
        return text ? { ...item, text: item.text + String(restore(text)) } : item;
      }
      if (item.type !== "tool") return item;
      const input = fields.get("input"),
        output = fields.get("output");
      return {
        ...item,
        ...(input ? { input: restore(input) } : {}),
        ...(output ? { output: restore(output) } : {}),
      };
    });
    return replayFingerprint({ ...turn, items }, userText);
  }

  async materialize(
    turn: AgentTurn,
    storage: HistoricalTaskAttachments,
    taskId: string,
  ): Promise<AgentTurn> {
    if (!this.#extras.size) return turn;
    const items: AgentItem[] = [];
    for (const item of turn.items) {
      const fields = this.#extras.get(item.id);
      if (!fields || (item.type !== "message" && item.type !== "tool")) {
        items.push(item);
        continue;
      }
      const files: { name: string; text: string }[] = [];
      let truncated = false;
      for (const [field, extra] of fields) {
        const body = extra.parts.join("");
        const name = field === "text" ? "回答续文" : field === "input" ? "工具输入" : "工具输出";
        truncated ||= extra.truncated;
        for (let offset = 0, part = 1; offset < body.length; part++) {
          const text = prefix(body.slice(offset), ATTACHMENT_CHARS);
          files.push({ name: `${name}-${String(part)}.txt`, text });
          offset += text.length;
        }
      }
      const attachments = files.length
        ? await storage.prepare(taskId, { ...emptyInput, textAttachments: files })
        : [];
      items.push(
        item.type === "message"
          ? {
              ...item,
              text: item.text + (truncated ? OMITTED : ""),
              attachments: [...(item.attachments ?? []), ...attachments],
            }
          : {
              ...item,
              ...(truncated
                ? { output: (typeof item.output === "string" ? item.output : "") + OMITTED }
                : {}),
              outputAttachments: attachments,
            },
      );
    }
    return { ...turn, items };
  }
}
