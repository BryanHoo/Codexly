import { createHash, randomUUID } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { AgentProviderTurnInput, AgentQueueRecord } from "@codexly/core";
import { HistoricalTaskAttachments, exportTaskAttachment } from "@codexly/core/task-attachments";

const batchPattern = /^[0-9a-f-]{36}$/u;
const queueIdPattern = /^queue-([0-9a-f-]{36})-(history-[0-9a-f]{64})$/u;

export class AcpQueueAttachments {
  readonly #history: HistoricalTaskAttachments;

  constructor(readonly directory: string) {
    this.#history = new HistoricalTaskAttachments(join(directory, "history", "task-attachments"));
  }

  #taskDirectory(task: string): string {
    return join(
      this.directory,
      "queue-attachments",
      createHash("sha256").update(task).digest("hex"),
    );
  }

  #location(task: string, id: string) {
    const match = queueIdPattern.exec(id);
    if (!match?.[1] || !match[2]) return { store: this.#history, id };
    return {
      store: new HistoricalTaskAttachments(join(this.#taskDirectory(task), match[1])),
      id: match[2],
    };
  }

  async prepare(task: string, input: AgentProviderTurnInput) {
    if (!input.images.length && !input.files.length && !input.textAttachments.length) return [];
    // 每次准备独占一批目录，正文、引用与预览导出可一起回收，同内容的其他条目独立持有。
    const batch = randomUUID();
    const store = new HistoricalTaskAttachments(join(this.#taskDirectory(task), batch));
    const attachments = await store.prepare(task, input);
    return attachments.map(({ id }) => ({ id: `queue-${batch}-${id}` }));
  }

  async metadata(task: string, id: string) {
    const location = this.#location(task, id);
    return { ...(await location.store.metadata(task, location.id)), id };
  }

  read(task: string, id: string) {
    const location = this.#location(task, id);
    return location.store.read(task, location.id);
  }

  async export(task: string, id: string) {
    const location = this.#location(task, id);
    const exported = await exportTaskAttachment(location.store, task, location.id);
    return { ...exported, attachment: { ...exported.attachment, id } };
  }

  async reconcile(task: string, loadRecords: () => Promise<AgentQueueRecord[]>): Promise<void> {
    const directory = this.#taskDirectory(task);
    const entries = await readdir(directory).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    });
    if (!entries.length) return;
    const retained = new Set<string>();
    for (const record of await loadRecords()) {
      for (const { id } of record.input.attachments) {
        const batch = queueIdPattern.exec(id)?.[1];
        if (batch) retained.add(batch);
      }
    }
    // 以原子提交后的队列文件为准。重试能回收上次删除或替换时遗留的目录。
    // 旧版引用可能与已发送历史共用，兼容读取，但不可按队列归属删除。
    for (const entry of entries) {
      if (batchPattern.test(entry) && !retained.has(entry)) {
        await rm(join(directory, entry), { recursive: true, force: true, maxRetries: 3 });
      }
    }
  }
}
