import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { AgentTurn } from "@codexly/protocol";
import type { ClaudeItemHistory } from "./item-history.js";
import { CLAUDE_HISTORY_PAGE_BYTES } from "./item-history.js";

const ENTRY_BYTES = 80;
const PREFIX = "claude-turns:";
const missing = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

export interface ClaudeSummaryPage {
  turns: AgentTurn[];
  cursor: string | null;
  /** 活动/恢复回合占用预算时，允许延后页内较旧回合，仍保持顶部游标按回合推进。 */
  resume: Map<string, string>;
}
function encode(task: string, before: number): string {
  return PREFIX + Buffer.from(JSON.stringify({ task, before })).toString("base64url");
}

/** 定长回合索引只保存回合身份哈希和原历史提交位置，摘要分页成本与工具条目数量无关。 */
export class ClaudeSummaryHistory {
  constructor(
    readonly items: ClaudeItemHistory,
    readonly path: (task: string) => string,
  ) {}

  async #size(path: string): Promise<number> {
    try {
      return (await stat(path)).size;
    } catch (error) {
      if (missing(error)) return 0;
      throw error;
    }
  }
  async #position(task: string): Promise<{ bytes: number; sourceEnd: number }> {
    let file;
    try {
      file = await open(`${this.path(task)}.summary-index`, "r");
      const bytes = (await file.stat()).size;
      if (bytes % ENTRY_BYTES !== 0) return { bytes: -1, sourceEnd: -1 };
      if (!bytes) return { bytes, sourceEnd: 0 };
      const entry = Buffer.alloc(ENTRY_BYTES);
      await file.read(entry, 0, entry.length, bytes - ENTRY_BYTES);
      if (!/^[a-f0-9]{80}$/u.test(entry.toString("ascii")))
        throw new Error("Invalid Claude summary index");
      return { bytes, sourceEnd: Number.parseInt(entry.subarray(64).toString("ascii"), 16) };
    } catch (error) {
      if (missing(error)) return { bytes: 0, sourceEnd: 0 };
      throw error;
    } finally {
      await file?.close();
    }
  }
  async ready(task: string): Promise<boolean> {
    return (
      (await this.#position(task)).sourceEnd === (await this.#size(`${this.path(task)}.jsonl`))
    );
  }
  /** 调用者持有任务写队列；只在旧历史或中断追加时补建，稳定读取不进入写队列。 */
  async prepare(task: string, load: (turn: AgentTurn) => Promise<void>): Promise<void> {
    let { bytes, sourceEnd } = await this.#position(task);
    const size = await this.#size(`${this.path(task)}.jsonl`);
    if (sourceEnd === size) return;
    if (bytes < 0 || sourceEnd > size) {
      bytes = 0;
      sourceEnd = 0;
    }
    const index = await open(
      `${this.path(task)}.summary-index`,
      constants.O_CREAT | constants.O_RDWR,
      0o600,
    );
    try {
      await index.truncate(bytes);
      const input = createReadStream(`${this.path(task)}.jsonl`, {
        start: sourceEnd,
        encoding: "utf8",
      });
      const lines = createInterface({ input, crlfDelay: Infinity });
      try {
        for await (const line of lines) {
          const turn = JSON.parse(line) as AgentTurn;
          await load(turn);
          sourceEnd += Buffer.byteLength(line) + 1;
          if (sourceEnd > size) throw new Error("Incomplete Claude history record");
          const entry = this.#entry(turn.id, sourceEnd);
          try {
            if ((await index.write(entry, bytes)).bytesWritten !== ENTRY_BYTES)
              throw new Error("Incomplete Claude summary index write");
          } catch (error) {
            await index.truncate(bytes);
            throw error;
          }
          bytes += ENTRY_BYTES;
        }
      } finally {
        lines.close();
        input.destroy();
      }
    } finally {
      await index.close();
    }
  }
  #entry(turn: string, sourceEnd: number): string {
    return (
      createHash("sha256").update(turn).digest("hex") + sourceEnd.toString(16).padStart(16, "0")
    );
  }
  async append(task: string, turn: string, sourceEnd: number): Promise<void> {
    const file = await open(
      `${this.path(task)}.summary-index`,
      constants.O_CREAT | constants.O_RDWR,
      0o600,
    );
    const size = (await file.stat()).size;
    try {
      if ((await file.write(this.#entry(turn, sourceEnd), size)).bytesWritten !== ENTRY_BYTES)
        throw new Error("Incomplete Claude summary index write");
    } catch (error) {
      await file.truncate(size);
      throw error;
    } finally {
      await file.close();
    }
  }
  async read(task: string, cursor?: string): Promise<ClaudeSummaryPage> {
    let before: number | undefined;
    if (cursor !== undefined) {
      if (!cursor.startsWith(PREFIX) || cursor.length > 8192)
        throw new Error("Invalid Claude summary cursor");
      const value = JSON.parse(
        Buffer.from(cursor.slice(PREFIX.length), "base64url").toString("utf8"),
      ) as { task: unknown; before: unknown };
      if (
        value.task !== task ||
        typeof value.before !== "number" ||
        !Number.isSafeInteger(value.before) ||
        value.before < 0 ||
        value.before % ENTRY_BYTES !== 0
      )
        throw new Error("Invalid Claude summary cursor");
      before = value.before;
    }
    let file;
    try {
      file = await open(`${this.path(task)}.summary-index`, "r");
    } catch (error) {
      if (missing(error) && before === undefined)
        return { turns: [], cursor: null, resume: new Map() };
      throw error;
    }
    try {
      const size = (await file.stat()).size;
      let end = before ?? size;
      if (end > size || size % ENTRY_BYTES !== 0) throw new Error("Invalid Claude summary cursor");
      const start = Math.max(0, end - 20 * ENTRY_BYTES);
      const keys = Buffer.alloc(end - start);
      await file.read(keys, 0, keys.length, start);
      const turns: AgentTurn[] = [];
      const resume = new Map<string, string>();
      let budget = CLAUDE_HISTORY_PAGE_BYTES;
      while (end > start) {
        const key = keys.subarray(end - start - ENTRY_BYTES, end - start - 16).toString("ascii");
        if (!/^[a-f0-9]{64}$/u.test(key)) throw new Error("Invalid Claude summary index");
        const turn = await this.items.summaryByKey(task, key);
        const cost = Buffer.byteLength(JSON.stringify(turn));
        if (cost > budget) {
          if (!turns.length) throw new Error("Claude turn summary exceeds page budget");
          break;
        }
        turns.unshift(turn);
        resume.set(turn.id, encode(task, end));
        budget -= cost;
        end -= ENTRY_BYTES;
      }
      return {
        turns,
        cursor: end ? encode(task, end) : null,
        resume,
      };
    } finally {
      await file.close();
    }
  }
}
