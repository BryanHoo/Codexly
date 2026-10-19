import { join } from "node:path";
import type { AgentProvider, AgentProviderEvent, AgentProviderTurnInput } from "@codexly/core";
import type {
  AgentTaskSettings,
  AgentPromptInput,
  AgentQueuedSubmission,
  AgentTurn,
} from "@codexly/protocol";
import { PersistentTaskQueue, type QueueRuntime } from "@codexly/core/persistent-task-queue";
import type { ClaudeAgentProvider } from "./provider.js";
import { ClaudeQueueRepository } from "./queue-repository.js";
import { ClaudeAttachments } from "./attachments.js";
import { exportClaudeAttachment } from "./attachment-export.js";

interface QueueResponse {
  data: readonly AgentQueuedSubmission[];
  queue: { data: readonly AgentQueuedSubmission[] };
  queuedSubmission: AgentQueuedSubmission;
  deleted: boolean;
  moved: boolean;
  taskId: string;
  turn: AgentTurn;
}

/** 宿主只适配磁盘引用与原生设置；执行、排序及未知结果恢复全部复用 Web 调度器。 */
export class ClaudeHostQueue {
  readonly #subscribed = new WeakSet<ClaudeAgentProvider>();
  readonly #queue: PersistentTaskQueue;
  constructor(
    directory: string,
    settings: (project: string, task: string) => Promise<AgentTaskSettings>,
    readonly emit: (event: AgentProviderEvent, project: string) => void,
  ) {
    const attachments = new ClaudeAttachments(join(directory, "attachments"));
    this.#queue = new PersistentTaskQueue({
      repository: new ClaudeQueueRepository(join(directory, "queues")),
      readTaskSettings: settings,
      attachmentStore: {
        read: async (_project, id, task) => {
          if (!task) throw new Error("Claude 附件缺少任务身份");
          return { attachment: await attachments.metadata(task, id) };
        },
        // 入队时已复制到任务永久附件仓储，出队不释放历史引用；任务删除统一回收。
        retainQueue: () => Promise.resolve(),
        releaseQueue: () => Promise.resolve(),
        startQueue: () => Promise.resolve(),
      },
      resolveProviderInput: async (_project, input, source, task) => {
        const provider = source as unknown as ClaudeAgentProvider;
        const images: AgentProviderTurnInput["images"][number][] = [];
        const files: AgentProviderTurnInput["files"][number][] = [];
        const textAttachments: AgentProviderTurnInput["textAttachments"][number][] = [];
        for (const { id } of input.attachments) {
          const metadata = await provider.config.attachments.metadata(task, id);
          if (metadata.kind === "text") {
            const attachment = await provider.readTaskAttachment(task, id);
            if (!attachment) throw new Error("Claude 排队附件不存在");
            textAttachments.push({
              name: metadata.name,
              text: Buffer.from(attachment.content).toString("utf8"),
            });
          } else {
            const exported = await exportClaudeAttachment(provider, task, id);
            if (metadata.kind === "image")
              images.push({
                path: exported.path,
                mediaType: metadata.mediaType as "image/png",
                detail: "auto",
              });
            else
              files.push({
                path: exported.path,
                name: metadata.name,
                mediaType: metadata.mediaType,
              });
          }
        }
        return {
          attachmentIds: input.attachments.map(({ id }) => id),
          providerInput: { text: input.text, skills: input.skills, images, files, textAttachments },
        };
      },
    });
  }
  #runtime(provider: ClaudeAgentProvider, taskId: string): QueueRuntime {
    return {
      projectId: provider.scope.id,
      taskId,
      provider: provider as unknown as AgentProvider,
      eventStream: {
        publish: (event) => {
          this.emit(event, provider.scope.id);
        },
      },
    };
  }
  subscribe(provider: ClaudeAgentProvider): void {
    if (this.#subscribed.has(provider)) return;
    this.#subscribed.add(provider);
    provider.subscribeEvents((event) => {
      if (event.type === "turn.completed")
        void this.#queue.startNext(this.#runtime(provider, event.taskId)).catch(() => {
          // 入队事实保持持久化；失败不丢消息，也不启动无界重试或轮询。
          process.stderr.write("Claude queue dispatch failed\n");
        });
    });
  }
  async execute(
    provider: ClaudeAgentProvider,
    method: string,
    params: Record<string, unknown>,
  ): Promise<Partial<QueueResponse>> {
    const taskId = typeof params["taskId"] === "string" ? params["taskId"] : "";
    if (!(await provider.readTaskMetadata(taskId))) throw new Error("Claude 队列任务不存在");
    if (method !== "queue.list") this.subscribe(provider);
    const runtime = this.#runtime(provider, taskId),
      id =
        typeof params["queuedSubmissionId"] === "string" ? params["queuedSubmissionId"] : undefined;
    if (method === "queue.list") return { data: await this.#queue.list(runtime) };
    if (method === "queue.move") {
      if (!id || ![-1, 1].includes(Number(params["offset"])))
        throw new Error("Claude 队列移动参数无效");
      return { moved: await this.#queue.move(runtime, id, params["offset"] as -1 | 1) };
    }
    if (method === "queue.delete") {
      if (!id) throw new Error("Claude 队列消息不存在");
      return {
        deleted: await this.#queue.delete(runtime, id),
        queue: { data: await this.#queue.list(runtime) },
      };
    }
    if (method === "queue.start" || method === "queue.steer") {
      const expected =
        method === "queue.steer" && typeof params["turnId"] === "string"
          ? params["turnId"]
          : undefined;
      if (method === "queue.steer" && (!expected || !id))
        throw new Error("Claude 队列引导缺少回合身份");
      const turn = await this.#queue.start(runtime, id, expected);
      return { taskId, turn, queue: { data: await this.#queue.list(runtime) } };
    }
    if (method !== "queue.add") throw new Error("不支持的 Claude 队列操作");
    const input = params["input"] as AgentProviderTurnInput;
    if (input.skills.length || typeof params["clientUserMessageId"] !== "string")
      throw new Error("Claude 队列输入无效");
    const attachments = await provider.config.attachments.prepare(taskId, input);
    const prompt: AgentPromptInput = {
      type: "prompt",
      text: input.text,
      skills: [],
      attachments: attachments.map(({ id }) => ({ id })),
    };
    const queuedSubmission = await this.#queue.add(runtime, prompt, params["clientUserMessageId"]);
    await this.#queue.startNext(runtime).catch(() => {
      process.stderr.write("Claude queue dispatch failed\n");
    });
    return { queuedSubmission, queue: { data: await this.#queue.list(runtime) } };
  }
}
