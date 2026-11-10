import { join } from "node:path";
import type { AgentProvider, AgentProviderTurnInput, AgentProviderEvent } from "@codexly/core";
import { PersistentTaskQueue, type QueueRuntime } from "@codexly/core/persistent-task-queue";
import { FileTaskQueueRepository } from "@codexly/core/file-task-queue";
import { HistoricalTaskAttachments, exportTaskAttachment } from "@codexly/core/task-attachments";
import type {
  AgentTurn,
  AgentImageMediaType,
  AgentQueuedSubmissionStatus,
} from "@codexly/protocol";

/** 调度与不确定结果恢复完全复用 Core；这里只适配 ACP 执行和授权附件引用。 */
export class AcpQueue {
  readonly #queue: PersistentTaskQueue;
  readonly attachments: HistoricalTaskAttachments;
  constructor(
    directory: string,
    execute: (project: string, task: string, input: AgentProviderTurnInput) => Promise<AgentTurn>,
    emit: (event: AgentProviderEvent, project: string) => void,
  ) {
    this.attachments = new HistoricalTaskAttachments(
      join(directory, "history", "task-attachments"),
    );
    this.#queue = new PersistentTaskQueue({
      repository: new FileTaskQueueRepository(join(directory, "queues")),
      startTurn: (runtime, input) => execute(runtime.projectId, runtime.taskId, input),
      attachmentStore: {
        read: async (_project, id, task) => {
          if (!task) throw new Error("Missing queue task");
          return { attachment: await this.attachments.metadata(task, id) };
        },
        retainQueue: () => Promise.resolve(),
        releaseQueue: () => Promise.resolve(),
        startQueue: () => Promise.resolve(),
      },
      resolveProviderInput: async (_project, input, _provider, task) => {
        const images: AgentProviderTurnInput["images"][number][] = [],
          files: AgentProviderTurnInput["files"][number][] = [],
          textAttachments: AgentProviderTurnInput["textAttachments"][number][] = [];
        for (const { id } of input.attachments) {
          const meta = await this.attachments.metadata(task, id);
          if (meta.kind === "text") {
            const data = await this.attachments.read(task, id);
            if (!data) throw new Error("Missing queue attachment");
            textAttachments.push({
              name: meta.name,
              text: Buffer.from(data.content).toString("utf8"),
            });
          } else {
            const exported = await exportTaskAttachment(this.attachments, task, id);
            if (meta.kind === "image")
              images.push({
                path: exported.path,
                mediaType: meta.mediaType as AgentImageMediaType,
                detail: "auto",
              });
            else files.push({ path: exported.path, name: meta.name, mediaType: meta.mediaType });
          }
        }
        return {
          attachmentIds: input.attachments.map((a) => a.id),
          providerInput: { text: input.text, skills: input.skills, images, files, textAttachments },
        };
      },
    });
    this.#emit = emit;
  }
  readonly #emit: (event: AgentProviderEvent, project: string) => void;
  async #runtime(provider: AgentProvider, project: string, task: string): Promise<QueueRuntime> {
    const metadata = await provider.readTaskMetadata?.(task);
    const engine = metadata?.engine;
    if (!engine) throw new Error("Queue task engine not found");
    return {
      provider,
      projectId: project,
      taskId: task,
      eventStream: {
        publish: (event) => {
          this.#emit({ ...event, provider: engine }, project);
        },
      },
    };
  }
  async add(
    provider: AgentProvider,
    project: string,
    task: string,
    input: AgentProviderTurnInput,
    clientMessage: string,
  ) {
    const runtime = await this.#runtime(provider, project, task);
    if (input.skills.length) throw new Error("ACP queue does not support legacy skills");
    const attachments = await this.attachments.prepare(task, input);
    return this.#queue.add(
      runtime,
      {
        type: "prompt",
        text: input.text,
        skills: [],
        attachments: attachments.map((a) => ({ id: a.id })),
      },
      clientMessage,
    );
  }
  async list(provider: AgentProvider, project: string, task: string) {
    return this.#queue.list(await this.#runtime(provider, project, task));
  }
  async start(provider: AgentProvider, project: string, task: string, id?: string) {
    const runtime = await this.#runtime(provider, project, task);
    // ACP 不伪造回合引导；活动回合结束后再启动下一条，不能转成私有厂商操作。
    if ((await provider.readTask(task))?.turns.some((t) => t.status === "running"))
      throw new Error("ACP task is running");
    return this.#queue.start(runtime, id);
  }
  async resume(provider: AgentProvider, project: string, task: string) {
    return this.#queue.startNext(await this.#runtime(provider, project, task));
  }
  async delete(provider: AgentProvider, project: string, task: string, id: string) {
    return this.#queue.delete(await this.#runtime(provider, project, task), id);
  }
  async move(provider: AgentProvider, project: string, task: string, id: string, offset: -1 | 1) {
    return this.#queue.move(await this.#runtime(provider, project, task), id, offset);
  }
  async reorder(provider: AgentProvider, project: string, task: string, ids: readonly string[]) {
    return this.#queue.reorder(await this.#runtime(provider, project, task), ids);
  }
  async update(
    provider: AgentProvider,
    project: string,
    task: string,
    id: string,
    input: AgentProviderTurnInput,
    status: AgentQueuedSubmissionStatus,
  ) {
    const runtime = await this.#runtime(provider, project, task);
    if (input.skills.length) throw new Error("ACP queue does not support legacy skills");
    const attachments = await this.attachments.prepare(task, input);
    return this.#queue.update(
      runtime,
      id,
      {
        type: "prompt",
        text: input.text,
        skills: [],
        attachments: attachments.map((a) => ({ id: a.id })),
      },
      status,
    );
  }
}
