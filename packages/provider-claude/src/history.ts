import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { appendFile, mkdir, open, opendir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentContextUsage,
  AgentMcpServer,
  ClaudePermissionMode,
  AgentPlan,
  AgentTurn,
} from "@codexly/protocol";
import { ClaudeItemHistory } from "./item-history.js";
import { HistoryRevisions } from "./history-revisions.js";
import type { AgentItem } from "@codexly/protocol";
import type { ClaudePlanTask } from "./task-plan.js";
import { copyClaudeStorage } from "./storage-copy.js";
import { renameStorageFile } from "./storage-rename.js";
import { ClaudeSummaryHistory } from "./summary-history.js";
import type { ClaudeSummaryPage } from "./summary-history.js";

export interface ClaudeTaskMetadata {
  /** true 表示已观察到原生会话；false 表示首次启动尚未收到 SDK 消息，缺省为旧版未知状态。 */
  sessionInitialized?: boolean;
  /** 最后一次 SDK 确认的主会话权限，供断线及重新打开聊天恢复展示。 */
  permissionMode?: ClaudePermissionMode;
  contextUsage: AgentContextUsage | null;
  plan: AgentPlan | null;
  /** 旧元数据无此字段；新任务工具需保留原生 ID，不能从展示文本推断关联。 */
  planTasks?: ClaudePlanTask[];
  model: string | null;
  mcpServers: AgentMcpServer[];
  /** 最后一次 SDK 实际观测时间；旧快照缺失时保持未知。 */
  mcpObservedAt?: string | null;
}

export interface ClaudeRecovery {
  entries: { turn: AgentTurn; mode: "complete" | "update" }[];
  metadata: ClaudeTaskMetadata;
}

const PAGE_BYTES = 4 * 1024 * 1024;
export const MAX_TURN_BYTES = 2 * 1024 * 1024;
const missing = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

/** 仅保存 UI 投影和启动证据，不承载模型上下文；恢复内容仍由官方 SDK 的 sessionId 决定。 */
export class ClaudeHistory {
  readonly #writes = new Map<string, Promise<void>>();
  readonly items: ClaudeItemHistory;
  readonly #summaries: ClaudeSummaryHistory;
  readonly #revisions = new HistoryRevisions<string>(512);
  /** 读取仅等待调用瞬间已入队的版本，不加入写队列，也不追赶后续 SDK 写入。 */
  barrier(task: string): Promise<void> {
    return this.#writes.get(task) ?? Promise.resolve();
  }
  constructor(readonly directory: string) {
    this.items = new ClaudeItemHistory(join(directory, "items"));
    this.#summaries = new ClaudeSummaryHistory(this.items, (task) => this.#path(task));
  }
  /** 按原时间顺序逐行复制展示回合；只读一条有界记录，历史长度不会放大内存占用。 */
  forkTask(
    source: string,
    target: string,
    lastTurnId: string | undefined,
    copyAttachments: (turn: AgentTurn) => Promise<void>,
  ): Promise<void> {
    return this.#write(source, () =>
      this.#write(target, async () => {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const input = createReadStream(`${this.#path(source)}.jsonl`, { encoding: "utf8" });
        const lines = createInterface({ input, crlfDelay: Infinity });
        const sourceItems = join(
          this.items.directory,
          createHash("sha256").update(source).digest("hex"),
        );
        const targetItems = join(
          this.items.directory,
          createHash("sha256").update(target).digest("hex"),
        );
        let found = lastTurnId === undefined;
        try {
          for await (const line of lines) {
            let turn = JSON.parse(line) as AgentTurn;
            try {
              turn = JSON.parse(
                await readFile(this.#updatePath(source, turn.id), "utf8"),
              ) as AgentTurn;
            } catch (error) {
              if (!missing(error)) throw error;
            }
            const turnHash = createHash("sha256").update(turn.id).digest("hex");
            await copyClaudeStorage(join(sourceItems, turnHash), join(targetItems, turnHash));
            await this.#append(target, this.#encode(turn));
            await copyAttachments(turn);
            if (turn.id === lastTurnId) {
              found = true;
              break;
            }
          }
          if (!found) throw new Error("Claude 分叉回合不存在");
        } finally {
          lines.close();
          input.destroy();
        }
      }),
    );
  }
  saveItems(task: string, turn: string, items: readonly AgentItem[]): Promise<void> {
    return this.#write(task, () => this.items.save(task, turn, items));
  }
  /** 排在已有写入之后清理全部任务文件，包含恢复记录、迟到回合覆盖与临时文件。 */
  deleteTask(task: string): Promise<void> {
    return this.#write(task, async () => {
      this.#revisions.deletePrefix(`${this.#path(task)}.`);
      await this.items.deleteTask(task);
      let directory;
      try {
        directory = await opendir(this.directory);
      } catch (error) {
        if (missing(error)) return;
        throw error;
      }
      const prefix = `${createHash("sha256").update(task).digest("hex")}.`;
      // 逐项扫描保持内存有界，不加载历史正文；精确哈希前缀隔离其他任务。
      for await (const entry of directory) {
        if (entry.name.startsWith(prefix))
          await rm(join(this.directory, entry.name), { force: true });
      }
    });
  }
  /** 旧版快照按需建立索引，新格式分页只探测就绪状态。 */
  async prepareItemHistory(task: string, turn: AgentTurn): Promise<void> {
    // 新格式探测是只读操作；仅索引或元数据缺失时进入写队列，入队后再检查以合并并发迁移。
    if (await this.items.indexed(task, turn.id)) return;
    await this.#write(task, async () => {
      if (!(await this.items.indexed(task, turn.id))) {
        this.items.invalidate(task, turn.id);
        await this.items.saveTurn(task, turn);
      }
    });
  }
  /** 无活动 SDK 的崩溃恢复只修正一次小元数据，不能再刷全部正文。 */
  recoverTurnMetadata(task: string, turn: AgentTurn): Promise<void> {
    return this.#write(task, () => this.items.saveMetadata(task, turn));
  }
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
  async #append(task: string, encoded: string): Promise<void> {
    await this.#prepareSummaryIndex(task);
    const path = `${this.#path(task)}.jsonl`;
    const file = await open(path, constants.O_CREAT | constants.O_RDWR, 0o600);
    try {
      const size = (await file.stat()).size;
      try {
        await appendFile(path, `${encoded}\n`, { mode: 0o600 });
        await this.#summaries.append(
          task,
          (JSON.parse(encoded) as AgentTurn).id,
          size + Buffer.byteLength(encoded) + 1,
        );
      } catch (error) {
        // 磁盘满可能已写入半行；回滚本次追加，保留此前历史并允许恢复事务重试。
        await file.truncate(size);
        throw error;
      }
    } finally {
      await file.close();
    }
  }
  async #prepareSummaryIndex(task: string): Promise<void> {
    await this.#summaries.prepare(task, async (original) => {
      let turn = original;
      try {
        turn = JSON.parse(await readFile(this.#updatePath(task, turn.id), "utf8")) as AgentTurn;
      } catch (error) {
        if (!missing(error)) throw error;
      }
      await this.items.prepareSummary(task, turn);
    });
  }
  /** 首屏仅访问回合索引及问题/答复文件；迁移按任务串行，普通读取不阻塞后续 Token。 */
  async readSummary(task: string, cursor?: string): Promise<ClaudeSummaryPage> {
    await this.barrier(task);
    if (!(await this.#summaries.ready(task)))
      await this.#write(task, () => this.#prepareSummaryIndex(task));
    return this.#summaries.read(task, cursor);
  }
  async activeSummary(task: string): Promise<AgentTurn | undefined> {
    await this.barrier(task);
    try {
      const id = await readFile(`${this.#path(task)}.active-id`, "utf8");
      return await this.items.summary(task, id);
    } catch (error) {
      if (!missing(error)) throw error;
    }
    // 旧版检查点没有小型身份文件；仅首次读取有界快照并补建摘要，之后不再读取过程正文。
    const turn = await this.active(task);
    if (!turn) return undefined;
    await this.#write(task, async () => {
      await this.items.prepareSummary(task, turn);
      await writeFile(`${this.#path(task)}.active-id`, turn.id, { mode: 0o600 });
    });
    return this.items.summary(task, turn.id);
  }
  saveMetadata(task: string, metadata: ClaudeTaskMetadata): Promise<void> {
    return this.#write(task, async () => {
      const encoded = JSON.stringify(metadata);
      const key = `${this.#path(task)}.metadata`,
        revision = createHash("sha256").update(encoded).digest("hex");
      if (this.#revisions.get(key) === revision) return;
      if (Buffer.byteLength(encoded) > 256 * 1024)
        throw new Error("Claude metadata budget exceeded");
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = `${this.#path(task)}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, encoded, { mode: 0o600 });
        await renameStorageFile(temporary, `${this.#path(task)}.metadata`);
        this.#revisions.set(key, revision);
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
  checkpoint(task: string, turn: AgentTurn, dirtyItems?: readonly AgentItem[]): Promise<void> {
    return this.#write(task, async () => {
      const encoded = this.#encode(turn);
      const key = `${this.#path(task)}.active`,
        revision = createHash("sha256").update(encoded).digest("hex");
      if (this.#revisions.get(key) === revision) return;
      if (dirtyItems) {
        if (dirtyItems.length) await this.items.save(task, turn.id, dirtyItems);
        await this.items.saveMetadata(task, turn);
      } else await this.items.saveTurn(task, turn);
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = `${this.#path(task)}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, encoded, { mode: 0o600 });
        await renameStorageFile(temporary, `${this.#path(task)}.active`);
        // 身份未变时不重复写入；摘要恢复无需解析包含大量过程条目的检查点正文。
        const identityKey = `${this.#path(task)}.active-id`;
        if (this.#revisions.get(identityKey) !== turn.id) {
          await writeFile(identityKey, turn.id, { mode: 0o600 });
          this.#revisions.set(identityKey, turn.id);
        }
        this.#revisions.set(key, revision);
      } finally {
        await rm(temporary, { force: true });
      }
    });
  }

  /** 新会话写入检查点前归档遗留回合；写队列保证追加与清理之间不会插入新回合。 */
  archiveActive(task: string): Promise<void> {
    return this.#write(task, async () => {
      let turn: AgentTurn;
      try {
        turn = JSON.parse(await readFile(`${this.#path(task)}.active`, "utf8")) as AgentTurn;
      } catch (error) {
        if (missing(error)) return;
        throw error;
      }
      // 已追加但尚未清理就退出时，旧回合仍在最新页；保留已有终态并避免重试重复追加。
      // 内部分页不等待当前写队列，避免在归档操作中等待自身；读取量始终有界。
      const page = await this.#readPage(task);
      const archived = page.turns.find((entry) => entry.id === turn.id);
      const terminal: AgentTurn = archived ?? {
        ...turn,
        status: "failed",
        error: "Claude process ended before completing this turn",
        completedAt: null,
      };
      // 元数据先于追加提交；追加失败后的重试仍沿用同一个终态，续页不会退回 running。
      await this.items.saveTurn(task, terminal);
      if (!archived) await this.#append(task, this.#encode(terminal));
      // 仅在归档成功后移除旧检查点；写入失败时保留恢复依据并阻止下一回合覆盖。
      await rm(`${this.#path(task)}.active`, { force: true });
      await rm(`${this.#path(task)}.active-id`, { force: true });
      this.#revisions.deletePrefix(`${this.#path(task)}.active`);
    });
  }

  complete(task: string, turn: AgentTurn): Promise<void> {
    return this.#write(task, async () => {
      const encoded = this.#encode(turn);
      await this.items.saveTurn(task, turn);
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      // 恢复记录可能在追加成功、元数据或清理失败后重放；最新页去重保证重试幂等。
      const page = await this.#readPage(task);
      if (!page.turns.some((entry) => entry.id === turn.id)) await this.#append(task, encoded);
      await rm(`${this.#path(task)}.active`, { force: true });
      await rm(`${this.#path(task)}.active-id`, { force: true });
      this.#revisions.deletePrefix(`${this.#path(task)}.active`);
    });
  }
  /** 先原子保存终态与元数据，再提交分页历史；两者未全部成功前保留恢复记录。 */
  saveRecovery(task: string, recovery: ClaudeRecovery): Promise<void> {
    return this.#write(task, async () => {
      // 每条投影沿用回合预算，恢复队列最多包含会话允许的 64 个投影。
      if (recovery.entries.length > 64) throw new Error("Claude recovery capacity exceeded");
      for (const entry of recovery.entries) this.#encode(entry.turn);
      if (Buffer.byteLength(JSON.stringify(recovery.metadata)) > 256 * 1024)
        throw new Error("Claude metadata budget exceeded");
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = `${this.#path(task)}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(recovery), { mode: 0o600 });
        await renameStorageFile(temporary, `${this.#path(task)}.recovery`);
      } finally {
        await rm(temporary, { force: true });
      }
    });
  }
  async recovery(task: string): Promise<ClaudeRecovery | undefined> {
    await this.#writes.get(task);
    try {
      return JSON.parse(await readFile(`${this.#path(task)}.recovery`, "utf8")) as ClaudeRecovery;
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
  }
  clearRecovery(task: string): Promise<void> {
    return this.#write(task, () => rm(`${this.#path(task)}.recovery`, { force: true }));
  }
  #updatePath(task: string, turnId: string) {
    return `${this.#path(task)}.${createHash("sha256").update(turnId).digest("hex")}.turn`;
  }

  /** 后台结果覆盖单个回合的有界快照，避免重写整份历史或追加重复分页记录。 */
  update(task: string, turn: AgentTurn): Promise<void> {
    return this.#write(task, async () => {
      const encoded = this.#encode(turn);
      await this.items.saveTurn(task, turn);
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const path = this.#updatePath(task, turn.id),
        temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, encoded, { mode: 0o600 });
        await renameStorageFile(temporary, path);
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
    await this.#writes.get(task);
    return this.#readPage(task, cursor);
  }

  async #readPage(
    task: string,
    cursor?: string,
  ): Promise<{ turns: AgentTurn[]; cursor: string | null }> {
    const offset = cursor === undefined ? undefined : Number(cursor);
    if (offset !== undefined && (!Number.isSafeInteger(offset) || offset < 0))
      throw new Error("Invalid Claude history cursor");
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
