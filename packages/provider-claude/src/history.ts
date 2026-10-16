import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentContextUsage, AgentMcpServer, AgentPlan, AgentTurn } from "@codexly/protocol";

export interface ClaudeTaskMetadata {
  contextUsage: AgentContextUsage | null;
  plan: AgentPlan | null;
  model: string | null;
  mcpServers: AgentMcpServer[];
}

const PAGE_BYTES = 4 * 1024 * 1024;
export const MAX_TURN_BYTES = 2 * 1024 * 1024;
const missing = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

/** 仅保存 UI 投影，不参与模型恢复；官方 SDK 的 sessionId 仍是唯一执行上下文。 */
export class ClaudeHistory {
  readonly #writes = new Map<string, Promise<void>>();
  constructor(readonly directory: string) {}
  #path(task: string) {
    return join(this.directory, createHash("sha256").update(task).digest("hex"));
  }
  #write(task: string, action: () => Promise<void>): Promise<void> {
    const result = (this.#writes.get(task) ?? Promise.resolve())
      .catch(() => undefined)
      .then(action);
    this.#writes.set(task, result);
    void result
      .finally(() => {
        if (this.#writes.get(task) === result) this.#writes.delete(task);
      })
      .catch(() => undefined);
    return result;
  }
  #encode(turn: AgentTurn) {
    const encoded = JSON.stringify(turn);
    if (Buffer.byteLength(encoded) > MAX_TURN_BYTES)
      throw new Error("Claude turn history exceeds the storage budget");
    return encoded;
  }
  saveMetadata(task: string, metadata: ClaudeTaskMetadata): Promise<void> {
    return this.#write(task, async () => {
      const encoded = JSON.stringify(metadata);
      if (Buffer.byteLength(encoded) > 256 * 1024)
        throw new Error("Claude metadata budget exceeded");
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = `${this.#path(task)}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, encoded, { mode: 0o600 });
        await rename(temporary, `${this.#path(task)}.metadata`);
      } finally {
        await rm(temporary, { force: true });
      }
    });
  }
  async metadata(task: string): Promise<ClaudeTaskMetadata | undefined> {
    await this.#writes.get(task);
    try {
      return JSON.parse(
        await readFile(`${this.#path(task)}.metadata`, "utf8"),
      ) as ClaudeTaskMetadata;
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
  }
  checkpoint(task: string, turn: AgentTurn): Promise<void> {
    return this.#write(task, async () => {
      const encoded = this.#encode(turn);
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = `${this.#path(task)}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, encoded, { mode: 0o600 });
        await rename(temporary, `${this.#path(task)}.active`);
      } finally {
        await rm(temporary, { force: true });
      }
    });
  }
  complete(task: string, turn: AgentTurn): Promise<void> {
    return this.#write(task, async () => {
      const encoded = this.#encode(turn);
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await appendFile(`${this.#path(task)}.jsonl`, `${encoded}\n`, { mode: 0o600 });
      await rm(`${this.#path(task)}.active`, { force: true });
    });
  }
  #updatePath(task: string, turnId: string) {
    return `${this.#path(task)}.${createHash("sha256").update(turnId).digest("hex")}.turn`;
  }

  /** 后台结果覆盖单个回合的有界快照，避免重写整份历史或追加重复分页记录。 */
  update(task: string, turn: AgentTurn): Promise<void> {
    return this.#write(task, async () => {
      const encoded = this.#encode(turn);
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const path = this.#updatePath(task, turn.id),
        temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, encoded, { mode: 0o600 });
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
    });
  }

  async active(task: string): Promise<AgentTurn | undefined> {
    await this.#writes.get(task);
    try {
      return JSON.parse(await readFile(`${this.#path(task)}.active`, "utf8")) as AgentTurn;
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
  }
  async read(
    task: string,
    cursor?: string,
  ): Promise<{ turns: AgentTurn[]; cursor: string | null }> {
    const offset = cursor === undefined ? undefined : Number(cursor);
    if (offset !== undefined && (!Number.isSafeInteger(offset) || offset < 0))
      throw new Error("Invalid Claude history cursor");
    await this.#writes.get(task);
    let file;
    try {
      file = await open(`${this.#path(task)}.jsonl`, "r");
    } catch (error) {
      if (missing(error)) return { turns: [], cursor: null };
      throw error;
    }
    try {
      const size = (await file.stat()).size,
        end = offset ?? size;
      if (end > size) throw new Error("Invalid Claude history cursor");
      const start = Math.max(0, end - PAGE_BYTES),
        buffer = Buffer.alloc(end - start);
      await file.read(buffer, 0, buffer.length, start);
      // 从完整行边界反向分页；字节游标避免 UTF-8 字符长度与文件偏移混淆。
      let position = start === 0 ? 0 : buffer.indexOf(10) + 1;
      const rows: { offset: number; turn: AgentTurn }[] = [];
      while (position < buffer.length) {
        const newline = buffer.indexOf(10, position);
        if (newline < 0) throw new Error("Incomplete Claude history record");
        rows.push({
          offset: start + position,
          turn: JSON.parse(buffer.subarray(position, newline).toString("utf8")) as AgentTurn,
        });
        position = newline + 1;
      }
      const selected = rows.slice(-20);
      return {
        turns: await Promise.all(
          selected.map(async ({ turn }) => {
            try {
              return JSON.parse(
                await readFile(this.#updatePath(task, turn.id), "utf8"),
              ) as AgentTurn;
            } catch (error) {
              if (missing(error)) return turn;
              throw error;
            }
          }),
        ),
        cursor: selected[0] && selected[0].offset > 0 ? String(selected[0].offset) : null,
      };
    } finally {
      await file.close();
    }
  }
}
