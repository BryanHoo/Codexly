import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, opendir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { AgentTurn } from "@codexly/protocol";

const TURN_BYTES = 2 * 1024 * 1024;
const PAGE_BYTES = 4 * 1024 * 1024;
interface Head {
  generation: string;
  end: number;
}
function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}
function validHead(value: unknown): value is Head {
  if (!value || typeof value !== "object") return false;
  const h = value as Head;
  return (
    typeof h.generation === "string" &&
    /^[a-f0-9-]{36}$/.test(h.generation) &&
    Number.isSafeInteger(h.end) &&
    h.end >= 0
  );
}
/** 只保存应用投影，模型上下文仍由 ACP agent 的 sessionId 恢复；读取量不随总历史增长。 */
export class AcpHistory {
  constructor(readonly directory: string) {}
  #key(task: string): string {
    return createHash("sha256").update(task).digest("hex");
  }
  #root(task: string): string {
    return join(this.directory, this.#key(task));
  }
  async #head(root: string): Promise<Head | undefined> {
    try {
      const h: unknown = JSON.parse(await readFile(join(root, "current"), "utf8"));
      if (!validHead(h)) throw new Error("ACP 历史指针损坏");
      return h;
    } catch (error) {
      if (missing(error)) return undefined;
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
    let lock;
    try {
      lock = await open(join(root, "writer.lock"), "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new Error("ACP 历史正在写入，请稍后重试", { cause: error });
      throw error;
    }
    try {
      return await action(root);
    } finally {
      await lock.close();
      await rm(join(root, "writer.lock"), { force: true });
    }
  }
  #encode(turn: AgentTurn): Buffer {
    const data = Buffer.from(`${JSON.stringify(turn)}\n`);
    if (data.length > TURN_BYTES) throw new Error("ACP 单回合历史超过存储预算");
    return data;
  }
  async replace(
    task: string,
    turns: AsyncIterable<AgentTurn> | Iterable<AgentTurn>,
  ): Promise<void> {
    await this.#locked(task, async (root) => {
      const generation = randomUUID();
      const path = join(root, `${generation}.jsonl`);
      const file = await open(path, "wx", 0o600);
      let end = 0;
      let committed = false;
      try {
        // 逐回合等待落盘，为调用方提供背压；重放失败不会发布半份新历史。
        for await (const turn of turns) {
          const data = this.#encode(turn);
          await file.writeFile(data);
          end += data.length;
        }
        await file.sync();
        await file.close();
        await this.#publish(root, { generation, end });
        committed = true;
      } finally {
        await file.close();
        if (!committed) await rm(path, { force: true });
      }
    });
  }
  async append(task: string, turn: AgentTurn): Promise<void> {
    const data = this.#encode(turn);
    await this.#locked(task, async (root) => {
      // 当前终态的恢复重试只检查有界最新页，不扫描全部历史。
      const existing = (await this.read(task)).turns.find((entry) => entry.id === turn.id);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(turn))
          throw new Error("ACP 回合提交内容冲突");
        return;
      }
      const old = await this.#head(root);
      const head = old ?? { generation: randomUUID(), end: 0 };
      const file = await open(join(root, `${head.generation}.jsonl`), "a+", 0o600);
      try {
        // 只公开指针中的已提交字节；上次写盘中断遗留的半行在重试时精确截断。
        await file.truncate(head.end);
        await file.writeFile(data);
        await file.sync();
        await this.#publish(root, { generation: head.generation, end: head.end + data.length });
      } finally {
        await file.close();
      }
    });
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
      throw error;
    }
    try {
      if (head.end > (await file.stat()).size) throw new Error("ACP 历史游标超出文件边界");
      const start = Math.max(0, head.end - PAGE_BYTES);
      const data = Buffer.alloc(head.end - start);
      let read = 0;
      while (read < data.length) {
        const result = await file.read(data, read, data.length - read, start + read);
        if (!result.bytesRead) throw new Error("ACP 历史记录不完整");
        read += result.bytesRead;
      }
      let position = start === 0 ? 0 : data.indexOf(10) + 1;
      const rows: { offset: number; turn: AgentTurn }[] = [];
      while (position < data.length) {
        const newline = data.indexOf(10, position);
        if (newline < 0) throw new Error("ACP 历史游标不是记录边界");
        rows.push({
          offset: start + position,
          turn: JSON.parse(data.subarray(position, newline).toString("utf8")) as AgentTurn,
        });
        position = newline + 1;
      }
      const selected = rows.slice(-20);
      const before = selected[0]?.offset ?? 0;
      return {
        turns: selected.map((row) => row.turn),
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
