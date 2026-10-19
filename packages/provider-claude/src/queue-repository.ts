import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentQueueRecord, AgentQueueRepository } from "@codexly/core";
import { AgentPromptInputSchema, AgentTurnSchema } from "@codexly/protocol";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { renameStorageFile } from "./storage-rename.js";

const RecordSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  taskId: Type.String({ minLength: 1 }),
  projectId: Type.String({ minLength: 1 }),
  clientUserMessageId: Type.String({ minLength: 1 }),
  input: AgentPromptInputSchema,
  status: Type.Union([Type.Literal("queued"), Type.Literal("editing")]),
  execution: Type.Optional(
    Type.Union([
      Type.Object({ state: Type.Literal("starting") }),
      Type.Object({ state: Type.Literal("started"), turn: AgentTurnSchema }),
    ]),
  ),
});
const QueueSchema = Type.Array(RecordSchema, { maxItems: 128 });

/** 桌面宿主以任务为单位原子替换小队列；正文走共享附件仓储，内存不随历史增长。 */
export class ClaudeQueueRepository implements AgentQueueRepository {
  constructor(readonly directory: string) {}
  path(task: string): string {
    return join(this.directory, createHash("sha256").update(task).digest("hex"));
  }
  async listQueue(project: string, task: string): Promise<AgentQueueRecord[]> {
    const path = this.path(task);
    let raw: string;
    try {
      if ((await stat(path)).size > 2 * 1024 * 1024) throw new Error("Claude 队列存储超过容量限制");
      raw = await readFile(path, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
    const records: unknown = JSON.parse(raw);
    if (
      !Value.Check(QueueSchema, records) ||
      records.some((record) => record.taskId !== task || record.projectId !== project)
    )
      throw new Error("Claude 队列存储无效");
    return records;
  }
  async #write(task: string, records: readonly AgentQueueRecord[]): Promise<void> {
    const body = JSON.stringify(records);
    if (records.length > 128 || Buffer.byteLength(body) > 2 * 1024 * 1024)
      throw new Error("Claude 消息队列已达容量限制");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = this.path(task),
      temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, body, { mode: 0o600 });
      await renameStorageFile(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  async addQueue(record: AgentQueueRecord): Promise<AgentQueueRecord> {
    const records = await this.listQueue(record.projectId, record.taskId);
    const existing = records.find(
      (entry) => entry.clientUserMessageId === record.clientUserMessageId,
    );
    if (existing) return existing;
    await this.#write(record.taskId, [...records, record]);
    return record;
  }
  async deleteQueue(project: string, task: string, id: string): Promise<boolean> {
    const records = await this.listQueue(project, task);
    const next = records.filter((entry) => entry.id !== id);
    if (next.length === records.length) return false;
    await this.#write(task, next);
    return true;
  }
  async setQueueExecution(
    record: AgentQueueRecord,
    execution: NonNullable<AgentQueueRecord["execution"]>,
  ): Promise<boolean> {
    const records = await this.listQueue(record.projectId, record.taskId);
    const index = records.findIndex((entry) => entry.id === record.id),
      current = records[index];
    if (!current || (execution.state === "starting" && current.execution)) return false;
    records[index] = { ...current, execution };
    await this.#write(record.taskId, records);
    return true;
  }
  async reorderQueue(project: string, task: string, ids: readonly string[]): Promise<void> {
    const records = await this.listQueue(project, task),
      entries = new Map(records.map((entry) => [entry.id, entry]));
    if (
      ids.length !== records.length ||
      new Set(ids).size !== records.length ||
      ids.some((id) => !entries.has(id))
    )
      throw new Error("Claude 队列已变化，请刷新后重试排序");
    await this.#write(
      task,
      ids.map((id) => {
        const entry = entries.get(id);
        if (!entry) throw new Error("Claude 队列消息不存在");
        return entry;
      }),
    );
  }
  async updateQueue(
    project: string,
    task: string,
    id: string,
    input: AgentQueueRecord["input"],
    status: AgentQueueRecord["status"],
  ): Promise<AgentQueueRecord | undefined> {
    const records = await this.listQueue(project, task),
      index = records.findIndex((entry) => entry.id === id),
      current = records[index];
    if (!current || current.execution) return undefined;
    const record = { ...current, input, status };
    records[index] = record;
    await this.#write(task, records);
    return record;
  }
}
