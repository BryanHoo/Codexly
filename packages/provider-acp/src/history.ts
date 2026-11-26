import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, opendir, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AgentTurn } from "@codexly/protocol";
import type { AcpStorageLeases } from "./storage-lease.js";
import { createReadStream } from "node:fs";
import { decodeHistoryEntry, replayFingerprint, type AcpHistoryEntry } from "./replay-anchor.js";
import { AcpHistoryCache, ACP_HISTORY_CACHE_BYTES } from "./history-cache.js";

const TURN_BYTES = 2 * 1024 * 1024;
const PAGE_BYTES = 4 * 1024 * 1024;
const RECENT_TURNS = 20;
interface Receipt {
  id: string;
  digest: string;
}
interface Head {
  generation: string;
  end: number;
  previous?: string[];
  incomplete?: true;
  recent?: Receipt[];
  forkPrefix?: number;
  forkPending?: boolean;
}
export class AcpHistoryCorruptionError extends Error {}

function receipt(turn: AgentTurn): Receipt {
  return { id: turn.id, digest: createHash("sha256").update(JSON.stringify(turn)).digest("hex") };
}

function keepRecent(recent: Receipt[], next: Receipt): void {
  if (recent.length === RECENT_TURNS) recent.shift();
  recent.push(next);
}

function decodeEntry(line: string): AcpHistoryEntry {
  try {
    const entry = decodeHistoryEntry(line);
    const turn: unknown = entry.turn;
    if (
      !turn ||
      typeof turn !== "object" ||
      !("id" in turn) ||
      typeof turn.id !== "string" ||
      !("items" in turn) ||
      !Array.isArray(turn.items)
    )
      throw new Error("ACP 回合结构无效");
    return entry;
  } catch (cause) {
    throw new AcpHistoryCorruptionError("ACP 历史回合记录损坏", { cause });
  }
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}
function validHead(value: unknown): value is Head {
  if (!value || typeof value !== "object") return false;
  const h = value as Omit<Head, "incomplete" | "recent"> & {
    incomplete?: unknown;
    recent?: unknown;
  };
  return (
    typeof h.generation === "string" &&
    /^[a-f0-9-]{36}$/.test(h.generation) &&
    Number.isSafeInteger(h.end) &&
    h.end >= 0 &&
    (h.incomplete === undefined || h.incomplete === true) &&
    (h.forkPrefix === undefined || (Number.isSafeInteger(h.forkPrefix) && h.forkPrefix > 0)) &&
    (h.forkPending === undefined || typeof h.forkPending === "boolean") &&
    (h.recent === undefined ||
      (Array.isArray(h.recent) &&
        h.recent.length <= RECENT_TURNS &&
        h.recent.every(
          (row: Receipt | null) =>
            typeof row?.id === "string" &&
            typeof row.digest === "string" &&
            /^[a-f0-9]{64}$/.test(row.digest),
        ))) &&
    (h.previous === undefined ||
      (Array.isArray(h.previous) &&
        h.previous.length <= 7 &&
        h.previous.every((id) => typeof id === "string" && /^[a-f0-9-]{36}$/.test(id))))
  );
}
/** 只保存应用投影，模型上下文仍由 ACP agent 的 sessionId 恢复；读取量不随总历史增长。 */
export class AcpHistory {
  readonly cache: AcpHistoryCache;
  constructor(
    readonly directory: string,
    readonly leases?: AcpStorageLeases,
    cacheBytes = ACP_HISTORY_CACHE_BYTES,
  ) {
    this.cache = new AcpHistoryCache(directory, leases, cacheBytes);
  }
  #key(task: string): string {
    return createHash("sha256").update(task).digest("hex");
  }
  #root(task: string): string {
    return join(this.directory, this.#key(task));
  }
  async #head(root: string): Promise<Head | undefined> {
    try {
      const h: unknown = JSON.parse(await readFile(join(root, "current"), "utf8"));
      if (!validHead(h)) throw new AcpHistoryCorruptionError("ACP 历史指针损坏");
      return h;
    } catch (error) {
      if (missing(error)) return undefined;
      if (error instanceof SyntaxError)
        throw new AcpHistoryCorruptionError("ACP 历史指针损坏", { cause: error });
      throw error;
    }
  }
  async #publish(root: string, head: Head): Promise<void> {
    const path = join(root, `${randomUUID()}.tmp`);
    const file = await open(path, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(head));
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await rename(path, join(root, "current"));
    } finally {
      await rm(path, { force: true });
    }
  }
  async #locked<T>(task: string, action: (root: string) => Promise<T>): Promise<T> {
    const root = this.#root(task);
    await mkdir(root, { recursive: true, mode: 0o700 });
    if (this.leases) {
      // 用真实目录统一 Web 与原生宿主的资源身份；活进程持有的锁不按时间抢占。
      const release = await this.leases.acquire(`history:${await realpath(root)}`);
      try {
        return await action(root);
      } finally {
        await release();
      }
    }
    let lock;
    try {
      lock = await open(join(root, "writer.lock"), "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw Object.assign(new Error("ACP 历史正在写入，请稍后重试", { cause: error }), {
          code: "EBUSY",
        });
      throw error;
    }
    try {
      return await action(root);
    } finally {
      await lock.close();
      await rm(join(root, "writer.lock"), { force: true });
    }
  }
  #encode(entry: AgentTurn | AcpHistoryEntry): Buffer {
    const value =
      "turn" in entry ? (entry.replayFingerprint ? { version: 2, ...entry } : entry.turn) : entry;
    const data = Buffer.from(`${JSON.stringify(value)}\n`);
    if (data.length > TURN_BYTES) throw new Error("ACP 单回合历史超过存储预算");
    return data;
  }
  async replace(
    task: string,
    turns: AsyncIterable<AgentTurn | AcpHistoryEntry> | Iterable<AgentTurn | AcpHistoryEntry>,
  ): Promise<void> {
    await this.#locked(task, async (root) => {
      const old = await this.#head(root).catch((error: unknown) => {
        // 旧指针损坏也允许 Agent 重建；普通 I/O 故障仍必须向调用方报告。
        if (error instanceof AcpHistoryCorruptionError) return undefined;
        throw error;
      });
      const generation = randomUUID();
      const path = join(root, `${generation}.jsonl`);
      const file = await open(path, "wx", 0o600);
      let end = 0;
      let inheritedEnd = 0;
      let count = 0;
      let committed = false;
      const recent: Receipt[] = [];
      try {
        // 逐回合等待落盘，为调用方提供背压；重放失败不会发布半份新历史。
        for await (const turn of turns) {
          const data = this.#encode(turn);
          await file.writeFile(data);
          end += data.length;
          if (++count === old?.forkPrefix) inheritedEnd = end;
          keepRecent(recent, receipt("turn" in turn ? turn.turn : turn));
        }
        await file.sync();
        await file.close();
        const previous = old ? [old.generation] : [];
        await this.#publish(root, {
          generation,
          end,
          previous,
          recent,
          ...(old?.forkPrefix && {
            forkPrefix: old.forkPrefix,
            forkPending: old.forkPending === true && end === inheritedEnd,
          }),
        });
        committed = true;
        await this.cache.rebuilt(task);
        // 只留一份旧投影供近期游标续读，避免每次重放长期累积八份完整正文。
        const retained = new Set([generation, ...previous].map((id) => `${id}.jsonl`));
        for await (const entry of await opendir(root)) {
          if (/^[a-f0-9-]{36}\.(jsonl|tmp)$/.test(entry.name) && !retained.has(entry.name))
            await rm(join(root, entry.name), { force: true });
        }
      } finally {
        await file.close();
        if (!committed) await rm(path, { force: true });
      }
    });
  }
  async append(
    task: string,
    turn: AgentTurn,
    userText?: string,
    fingerprint?: string,
    incomplete = false,
    acpMessageId?: string,
  ): Promise<void> {
    const data = this.#encode(
      userText === undefined
        ? turn
        : {
            turn,
            replayFingerprint: fingerprint ?? replayFingerprint(turn, userText),
            ...(acpMessageId ? { acpMessageId } : {}),
          },
    );
    const next = receipt(turn);
    await this.#locked(task, async (root) => {
      const old = await this.#head(root);
      // 原子指针同时提交字节边界和近期回合凭证；只有旧版指针首次追加时读取一页升级。
      const recent = old?.recent ?? (old ? (await this.read(task)).turns.map(receipt) : []);
      const existing = recent.find((entry) => entry.id === turn.id);
      if (existing) {
        if (existing.digest !== next.digest) throw new Error("ACP 回合提交内容冲突");
        return;
      }
      const head = old ?? { generation: randomUUID(), end: 0 };
      const file = await open(join(root, `${head.generation}.jsonl`), "a+", 0o600);
      try {
        // 只公开指针中的已提交字节；上次写盘中断遗留的半行在重试时精确截断。
        if ((await file.stat()).size < head.end)
          throw new AcpHistoryCorruptionError("ACP 历史记录不完整");
        await file.truncate(head.end);
        await file.writeFile(data);
        await file.sync();
        keepRecent(recent, next);
        await this.#publish(root, {
          ...head,
          ...(head.forkPending && !turn.acpBackground ? { forkPending: false } : {}),
          end: head.end + data.length,
          recent,
          ...(incomplete ? { incomplete: true as const } : {}),
        });
      } finally {
        await file.close();
      }
    });
  }
  /** 降级分支的历史前缀独立于原生会话，修复回放时须保留。 */
  async markForkPrefix(task: string, count: number): Promise<void> {
    await this.#locked(task, async (root) => {
      const head = await this.#head(root);
      if (!head?.end) throw new Error("任务分支历史缺失");
      await this.#publish(root, { ...head, forkPrefix: count, forkPending: true });
    });
  }

  async forkPrefix(task: string): Promise<number> {
    return (await this.#head(this.#root(task)))?.forkPrefix ?? 0;
  }

  async forkContextPending(task: string): Promise<boolean> {
    return (await this.#head(this.#root(task)))?.forkPending === true;
  }

  async deleteTask(task: string): Promise<void> {
    await this.#locked(task, async (root) => {
      const directory = await opendir(root);
      for await (const entry of directory) {
        if (entry.name !== "writer.lock")
          await rm(join(root, entry.name), { recursive: true, force: true });
      }
      await rm(join(this.directory, "attachments", this.#key(task)), {
        recursive: true,
        force: true,
      });
    });
  }
  /** 只读取小型历史指针，首发保护不加载整页消息。 */
  async hasTurns(task: string): Promise<boolean> {
    return ((await this.#head(this.#root(task)))?.end ?? 0) > 0;
  }
  /** 提交指针已原子发布，只校验覆盖标记和文件边界，不为续聊读取或解析整份历史。 */
  async needsReplay(task: string): Promise<boolean> {
    return (await this.#head(this.#root(task)))?.incomplete === true;
  }

  async hasCompleteHistory(task: string): Promise<boolean> {
    const root = this.#root(task);
    const head = await this.#head(root).catch((error: unknown) => {
      if (error instanceof AcpHistoryCorruptionError) return undefined;
      throw error;
    });
    if (!head?.end || head.incomplete) return false;
    try {
      return (await stat(join(root, `${head.generation}.jsonl`))).size >= head.end;
    } catch (error) {
      if (missing(error)) return false;
      throw error;
    }
  }
  /** resume 不补旧消息；持久标记缺口，后续追加新回合也不能冒充一份完整历史。 */
  async markIncomplete(task: string): Promise<void> {
    if ((await this.#head(this.#root(task)))?.incomplete) return;
    await this.#locked(task, async (root) => {
      const head = await this.#head(root);
      if (head?.incomplete) return;
      if (head) {
        await this.#publish(root, { ...head, incomplete: true });
      } else {
        const generation = randomUUID();
        await (await open(join(root, `${generation}.jsonl`), "wx", 0o600)).close();
        await this.#publish(root, { generation, end: 0, incomplete: true });
      }
    });
  }
  /** 搜索锚定当前不可变投影；后续追加或重放不能改变命中的上下文页。 */
  async currentCursor(task: string): Promise<string | null> {
    const head = await this.#head(this.#root(task));
    return head
      ? Buffer.from(
          JSON.stringify({ task: this.#key(task), generation: head.generation, end: head.end }),
        ).toString("base64url")
      : null;
  }
  /** 以固定读取块按原顺序消费已提交历史，重放核对不累计全部回合或游标。 */
  async *entries(task: string, reconciling = false): AsyncGenerator<AcpHistoryEntry> {
    const root = this.#root(task);
    const head = await this.#head(root).catch((error: unknown) => {
      if (reconciling && error instanceof AcpHistoryCorruptionError) return undefined;
      throw error;
    });
    if (!head?.end) return;
    const path = join(root, `${head.generation}.jsonl`);
    let end = head.end;
    if (reconciling) {
      // 截断时只使用仍完整的旧记录，保留可确认的本地身份与附件。
      try {
        end = Math.min(end, (await stat(path)).size);
      } catch (error) {
        if (missing(error)) return;
        throw error;
      }
    }
    if (!end) return;
    const stream = createReadStream(path, {
      end: end - 1,
      highWaterMark: 64 * 1024,
    });
    let carry: Buffer = Buffer.alloc(0);
    try {
      for await (const chunk of stream) {
        const data: Buffer = carry.length
          ? Buffer.concat([carry, chunk as Buffer])
          : (chunk as Buffer);
        let start = 0,
          end: number;
        while ((end = data.indexOf(10, start)) >= 0) {
          if (end - start > TURN_BYTES)
            throw new AcpHistoryCorruptionError("ACP 单回合历史超过存储预算");
          try {
            yield decodeEntry(data.subarray(start, end).toString("utf8"));
          } catch (error) {
            if (!reconciling || !(error instanceof AcpHistoryCorruptionError)) throw error;
          }
          start = end + 1;
        }
        carry = data.subarray(start);
        if (carry.length > TURN_BYTES)
          throw new AcpHistoryCorruptionError("ACP 单回合历史超过存储预算");
      }
      if (carry.length) throw new AcpHistoryCorruptionError("ACP 历史记录不完整");
    } catch (error) {
      if (!reconciling || !(error instanceof AcpHistoryCorruptionError)) throw error;
    } finally {
      stream.destroy();
    }
  }
  async read(
    task: string,
    cursor?: string,
  ): Promise<{ turns: AgentTurn[]; cursor: string | null }> {
    const root = this.#root(task);
    let head: Head | undefined;
    if (cursor !== undefined) {
      if (cursor.length > 256) throw new Error("无效 ACP 历史游标");
      try {
        const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
        if (!validHead(parsed) || !("task" in parsed) || parsed.task !== this.#key(task))
          throw new Error("游标不匹配");
        head = parsed;
      } catch {
        throw new Error("无效 ACP 历史游标");
      }
    } else head = await this.#head(root);
    if (!head) return { turns: [], cursor: null };
    let file;
    try {
      file = await open(join(root, `${head.generation}.jsonl`), "r");
    } catch (error) {
      if (cursor && missing(error)) throw new Error("ACP 历史游标已失效", { cause: error });
      if (missing(error))
        throw new AcpHistoryCorruptionError("ACP 历史记录文件缺失", { cause: error });
      throw error;
    }
    try {
      if (head.end > (await file.stat()).size) {
        if (cursor) throw new Error("ACP 历史游标超出文件边界");
        throw new AcpHistoryCorruptionError("ACP 历史记录不完整");
      }
      const start = Math.max(0, head.end - PAGE_BYTES);
      const data = Buffer.alloc(head.end - start);
      let read = 0;
      while (read < data.length) {
        const result = await file.read(data, read, data.length - read, start + read);
        if (!result.bytesRead) throw new AcpHistoryCorruptionError("ACP 历史记录不完整");
        read += result.bytesRead;
      }
      // 从页尾定位最多 20 条完整记录，再解码要返回的回合。
      let boundary = data.length - 1;
      for (let count = 0; boundary > 0 && count < RECENT_TURNS; count++)
        boundary = data.lastIndexOf(10, boundary - 1);
      let position = Math.max(boundary + 1, start === 0 ? 0 : data.indexOf(10) + 1);
      const rows: { offset: number; turn: AgentTurn }[] = [];
      while (position < data.length) {
        const newline = data.indexOf(10, position);
        if (newline < 0) {
          if (cursor) throw new Error("ACP 历史游标不是记录边界");
          throw new AcpHistoryCorruptionError("ACP 历史记录不完整");
        }
        rows.push({
          offset: start + position,
          turn: decodeEntry(data.subarray(position, newline).toString("utf8")).turn,
        });
        position = newline + 1;
      }
      const before = rows[0]?.offset ?? 0;
      return {
        turns: rows.map((row) => row.turn),
        cursor:
          before > 0
            ? Buffer.from(
                JSON.stringify({ task: this.#key(task), generation: head.generation, end: before }),
              ).toString("base64url")
            : null,
      };
    } finally {
      await file.close();
    }
  }
}
