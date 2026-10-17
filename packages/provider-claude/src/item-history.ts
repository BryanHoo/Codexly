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

/** 磁盘索引只保存定长摘要，记录原位更新；内存和每次反向读取均与总历史长度无关。 */
export class ClaudeItemHistory {
  readonly #revisions = new HistoryRevisions<{ offset: number; revision: string }>(8192);
  readonly #metadata = new HistoryRevisions<string>(512);
  constructor(readonly directory: string) {}
  async deleteTask(task: string): Promise<void> {
    const prefix = join(this.directory, hash(task));
    this.#revisions.deletePrefix(prefix);
    this.#metadata.deletePrefix(prefix);
    await rm(prefix, { recursive: true, force: true });
  }
  /** 仅迁移缺失索引时调用，避免已有进程内版本掩盖旧格式或外部删除。 */
  invalidate(task: string, turn: string): void {
    this.#revisions.deletePrefix(this.#path(task, turn));
    this.#metadata.deletePrefix(this.#path(task, turn));
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
      if (items.length) return;
      try {
        const file = await open(join(directory, "index"), "r");
        await file.close();
        return;
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const index = await open(join(directory, "index"), "a+", 0o600);
    try {
      // 进程在追加摘要中途退出时，截去不完整尾部，重放同一记录即可修复。
      let end = Math.floor((await index.stat()).size / INDEX_ENTRY_BYTES) * INDEX_ENTRY_BYTES;
      await index.truncate(end);
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
      }
    } finally {
      await index.close();
    }
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
