import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentItem, AgentTurn } from "@codexly/protocol";
import { HistoryRevisions } from "./history-revisions.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const missing = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";
const INDEX_ENTRY_BYTES = 64;
export const CLAUDE_HISTORY_PAGE_BYTES = 352 * 1024;
const ITEM_LIMIT = 100;
interface StoredItem {
  offset: number;
  item: AgentItem;
}
interface SummaryEntry {
  key: string;
  offset: number;
}
interface SummaryIndex {
  user?: SummaryEntry;
  assistant?: SummaryEntry;
  last: number;
}

/** 磁盘索引只保存定长摘要，记录原位更新；内存和每次反向读取均与总历史长度无关。 */
export class ClaudeItemHistory {
  readonly #revisions = new HistoryRevisions<{ offset: number; revision: string }>(8192);
  readonly #metadata = new HistoryRevisions<string>(512);
  readonly #summaries = new HistoryRevisions<SummaryIndex>(512);
  constructor(readonly directory: string) {}
  async deleteTask(task: string): Promise<void> {
    const prefix = join(this.directory, hash(task));
    this.#revisions.deletePrefix(prefix);
    this.#metadata.deletePrefix(prefix);
    this.#summaries.deletePrefix(prefix);
    await rm(prefix, { recursive: true, force: true });
  }
  /** 仅迁移缺失索引时调用，避免已有进程内版本掩盖旧格式或外部删除。 */
  invalidate(task: string, turn: string): void {
    this.#revisions.deletePrefix(this.#path(task, turn));
    this.#metadata.deletePrefix(this.#path(task, turn));
    this.#summaries.deletePrefix(this.#path(task, turn));
  }
  #path(task: string, turn: string) {
    return join(this.directory, hash(task), hash(turn));
  }
  async #atomic(path: string, value: unknown) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  /** 调用者以任务写队列串行执行，确保首次出现顺序不受工具完成先后影响。 */
  async save(task: string, turn: string, items: readonly AgentItem[]): Promise<void> {
    const directory = this.#path(task, turn);
    // 先按内容版本筛选 dirty 集合；稳定记录不打开索引，也不读取旧正文。
    const dirty = items
      .filter((item) => item.id !== `${turn}:rendering-omitted`)
      .map((item) => {
        const key = hash(item.id),
          path = join(directory, key),
          revision = hash(JSON.stringify(item));
        return { item, key, path, revision, cached: this.#revisions.get(path) };
      })
      .filter(({ revision, cached }) => cached?.revision !== revision);
    if (!dirty.length) {
      // 空回合仍须建立索引，供分页和旧格式迁移判断使用。
      if (items.length && this.#summaries.get(join(directory, "summary"))) return;
      try {
        const file = await open(join(directory, "index"), "r");
        await file.close();
        await access(join(directory, "summary"));
        return;
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const index = await open(join(directory, "index"), "a+", 0o600);
    try {
      // 进程在追加索引中途退出时，截去不完整尾部；摘要落后于索引则重新确认引用。
      let end = Math.floor((await index.stat()).size / INDEX_ENTRY_BYTES) * INDEX_ENTRY_BYTES;
      await index.truncate(end);
      const summaryPath = join(directory, "summary");
      let summary = this.#summaries.get(summaryPath);
      if (!summary) {
        try {
          summary = JSON.parse(await readFile(summaryPath, "utf8")) as SummaryIndex;
        } catch (error) {
          if (!missing(error)) throw error;
        }
      }
      if (summary?.last !== (end ? end - INDEX_ENTRY_BYTES : -1)) summary = undefined;
      const previousSummary = summary ? JSON.stringify(summary) : undefined;
      summary = { ...(summary ?? (await this.#buildSummary(directory, index, end))) };
      for (const { item, key, path, revision, cached } of dirty) {
        let previous: StoredItem | undefined;
        if (!cached) {
          try {
            previous = JSON.parse(await readFile(path, "utf8")) as StoredItem;
          } catch (error) {
            if (!missing(error)) throw error;
          }
        }
        const offset = cached?.offset ?? previous?.offset ?? end;
        if (offset > end || offset % INDEX_ENTRY_BYTES !== 0)
          throw new Error("Invalid Claude item index");
        // 先原子写记录再追加索引；追加失败后的重试沿用原偏移，不产生重复身份。
        if (cached || !previous || hash(JSON.stringify(previous.item)) !== revision)
          await this.#atomic(path, { offset, item });
        if (offset === end) {
          try {
            const written = await index.write(key);
            if (written.bytesWritten !== INDEX_ENTRY_BYTES)
              throw new Error("Incomplete Claude item index write");
          } catch (error) {
            await index.truncate(end);
            throw error;
          }
          end += INDEX_ENTRY_BYTES;
        }
        // 原子记录及索引均提交后才推进版本；失败重试不能被缓存误判为已保存。
        this.#revisions.set(path, { offset, revision });
        // 仅保存问题、最近助手正文的位置；工具更新沿用原偏移，不能把迟到结果误判为新过程。
        summary.last = Math.max(summary.last, offset);
        if (
          item.type === "message" &&
          item.role === "user" &&
          (!summary.user || offset <= summary.user.offset)
        )
          summary.user = { key, offset };
        if (
          item.type === "message" &&
          item.role === "assistant" &&
          (!summary.assistant || offset >= summary.assistant.offset)
        )
          summary.assistant = { key, offset };
      }
      if (JSON.stringify(summary) !== previousSummary) {
        await this.#atomic(summaryPath, summary);
      }
      this.#summaries.set(summaryPath, summary);
    } catch (error) {
      // 摘要提交失败时清除版本缓存，重试必须重新确认正文及摘要都已持久化。
      this.invalidate(task, turn);
      throw error;
    } finally {
      await index.close();
    }
  }
  /** 仅旧格式或迁移中断时扫描一次已有索引，按小批次读取，避免全量正文驻留内存。 */
  async #buildSummary(
    directory: string,
    index: Awaited<ReturnType<typeof open>>,
    size: number,
  ): Promise<SummaryIndex> {
    const summary: SummaryIndex = { last: -1 };
    for (let start = 0; start < size; start += ITEM_LIMIT * INDEX_ENTRY_BYTES) {
      const keys = Buffer.alloc(Math.min(ITEM_LIMIT * INDEX_ENTRY_BYTES, size - start));
      await index.read(keys, 0, keys.length, start);
      for (let offset = 0; offset < keys.length; offset += INDEX_ENTRY_BYTES) {
        const key = keys.subarray(offset, offset + INDEX_ENTRY_BYTES).toString("ascii");
        if (!/^[a-f0-9]{64}$/u.test(key)) throw new Error("Invalid Claude item index");
        const { item } = JSON.parse(await readFile(join(directory, key), "utf8")) as StoredItem;
        const entry = { key, offset: start + offset };
        summary.last = entry.offset;
        if (item.type === "message" && item.role === "user" && !summary.user) summary.user = entry;
        if (item.type === "message" && item.role === "assistant") summary.assistant = entry;
      }
    }
    return summary;
  }
  async prepareSummary(task: string, turn: AgentTurn): Promise<void> {
    if (!(await this.indexed(task, turn.id))) {
      this.invalidate(task, turn.id);
      await this.saveTurn(task, turn);
    } else await this.save(task, turn.id, []);
  }
  /** 摘要只读取至多两条消息正文，不打开过程索引或扫描工具文件。 */
  async summary(task: string, turn: string): Promise<AgentTurn> {
    return this.summaryByKey(task, hash(turn));
  }
  async summaryByKey(task: string, key: string): Promise<AgentTurn> {
    const directory = join(this.directory, hash(task), key);
    const metadata = JSON.parse(await readFile(join(directory, "turn"), "utf8")) as Omit<
      AgentTurn,
      "items"
    >;
    const summary = JSON.parse(await readFile(join(directory, "summary"), "utf8")) as SummaryIndex;
    const items: AgentItem[] = [];
    if (summary.user)
      items.push(
        (JSON.parse(await readFile(join(directory, summary.user.key), "utf8")) as StoredItem).item,
      );
    // 没有明确 phase 的旧 Claude 消息仅在回合成功且正文位于过程之后时视为最终答复。
    if (summary.assistant) {
      const item = (
        JSON.parse(await readFile(join(directory, summary.assistant.key), "utf8")) as StoredItem
      ).item;
      if (
        item.type === "message" &&
        (item.phase === "final_answer" ||
          (metadata.status === "completed" &&
            item.phase === undefined &&
            summary.assistant.offset === summary.last))
      )
        items.push(item);
    }
    return { ...metadata, items };
  }
  async saveTurn(task: string, turn: AgentTurn): Promise<void> {
    await this.save(task, turn.id, turn.items);
    await this.saveMetadata(task, turn);
  }
  async saveMetadata(task: string, turn: AgentTurn): Promise<void> {
    const directory = this.#path(task, turn.id);
    const { items: _items, ...metadata } = turn;
    const path = join(directory, "turn"),
      revision = hash(JSON.stringify(metadata));
    if (this.#metadata.get(path) === revision) return;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      if ((await readFile(path, "utf8")) === JSON.stringify(metadata)) {
        this.#metadata.set(path, revision);
        return;
      }
    } catch (error) {
      if (!missing(error)) throw error;
    }
    await this.#atomic(path, metadata);
    this.#metadata.set(path, revision);
  }
  /** 索引和回合元数据都存在才算新格式就绪，迁移中断后必须允许重试。 */
  async indexed(task: string, turn: string): Promise<boolean> {
    const directory = this.#path(task, turn);
    let file;
    try {
      file = await open(join(directory, "index"), "r");
      await access(join(directory, "turn"));
      return true;
    } catch (error) {
      if (missing(error)) return false;
      throw error;
    } finally {
      await file?.close();
    }
  }
  async turn(task: string, turn: string): Promise<AgentTurn> {
    const metadata = JSON.parse(
      await readFile(join(this.#path(task, turn), "turn"), "utf8"),
    ) as Omit<AgentTurn, "items">;
    return { ...metadata, items: [] };
  }
  async read(
    task: string,
    turn: string,
    before: number | null = null,
    budget = CLAUDE_HISTORY_PAGE_BYTES,
    limit = ITEM_LIMIT,
  ): Promise<{ items: AgentItem[]; before: number | null } | undefined> {
    const directory = this.#path(task, turn);
    let index;
    try {
      index = await open(join(directory, "index"), "r");
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
    try {
      const size = Math.floor((await index.stat()).size / INDEX_ENTRY_BYTES) * INDEX_ENTRY_BYTES;
      let end = before ?? size;
      if (!Number.isSafeInteger(end) || end < 0 || end > size || end % INDEX_ENTRY_BYTES !== 0)
        throw new Error("Invalid Claude item cursor");
      const start = Math.max(0, end - Math.min(ITEM_LIMIT, limit) * INDEX_ENTRY_BYTES);
      const keys = Buffer.alloc(end - start);
      await index.read(keys, 0, keys.length, start);
      const items: AgentItem[] = [];
      let bytes = 0;
      while (end > start) {
        const key = keys.subarray(end - start - INDEX_ENTRY_BYTES, end - start).toString("ascii");
        if (!/^[a-f0-9]{64}$/u.test(key)) throw new Error("Invalid Claude item index");
        const raw = await readFile(join(directory, key), "utf8");
        const entry = JSON.parse(raw) as StoredItem;
        const cost = Buffer.byteLength(JSON.stringify(entry.item)) + 1;
        if (bytes + cost > budget) break;
        items.unshift(entry.item);
        bytes += cost;
        end -= INDEX_ENTRY_BYTES;
      }
      return { items, before: end > 0 ? end : null };
    } finally {
      await index.close();
    }
  }
}
