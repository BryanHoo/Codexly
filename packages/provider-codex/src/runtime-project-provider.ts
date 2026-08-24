import type {
  AgentProvider,
  AgentProviderAttachment,
  AgentProviderEventListener,
  AgentProviderEventSubscriptionOptions,
  AgentProviderQueue,
  AgentProviderTaskSnapshot,
  AgentProviderTurnInput,
  AgentTaskUnsubscribeStatus,
  AgentTaskScope,
  ListAgentTasksInput,
  ReadAgentTaskInput,
  ResolvePendingRequestInput,
  StartAgentTaskOptions,
} from "@code-agent/core";
import {
  isAgentFastModeAvailable,
  type AgentBackgroundTerminalPage,
  type AgentCapabilities,
  type AgentProviderConnectionStatus,
  type AgentMcpServerPage,
  type AgentModelPage,
  type AgentReviewTarget,
  type AgentSandboxMode,
  type AgentSkillPage,
  type AgentTask,
  type AgentTaskPage,
  type AgentTurn,
  type AgentTurnOptions,
  type PendingRequest,
  type UploadAgentFeedbackRequest,
} from "@code-agent/protocol";

import { CodexProtocolMappingError } from "./codex-protocol-mapping.js";
import type { CodexAgentProvider } from "./agent-provider-runtime.js";
import { createOwnedAgentProviderQueue } from "./runtime-provider-queue.js";

export interface CodexRuntimeProjectOwner {
  assertTaskOwner(project: AgentTaskScope, taskId: string): void;
  beginTaskRead(project: AgentTaskScope, taskId: string): boolean;
  claimTask(project: AgentTaskScope, taskId: string): void;
  isTaskOwner(project: AgentTaskScope, taskId: string): boolean;
  readProviderConnection(): Promise<AgentProviderConnectionStatus>;
  releaseProvisionalTask(project: AgentTaskScope, taskId: string): void;
  releaseTask(project: AgentTaskScope, taskId: string): void;
}

export class CodexRuntimeProjectProvider implements AgentProvider {
  readonly #delegate: CodexAgentProvider;
  readonly #project: AgentTaskScope;
  readonly #runtime: CodexRuntimeProjectOwner;
  public readonly queue: AgentProviderQueue;

  public constructor(
    runtime: CodexRuntimeProjectOwner,
    delegate: CodexAgentProvider,
    project: AgentTaskScope,
  ) {
    this.#delegate = delegate;
    this.#project = project;
    this.#runtime = runtime;
    this.queue = createOwnedAgentProviderQueue(delegate.queue, (taskId) =>
      this.#ensureTaskOwner(taskId),
    );
  }

  public async archiveTask(taskId: string): Promise<void> {
    await this.#ensureTaskOwner(taskId);
    return this.#delegate.archiveTask(taskId);
  }

  public compactTask(taskId: string): Promise<void> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    return this.#delegate.compactTask(taskId);
  }

  public async deleteTask(taskId: string): Promise<void> {
    await this.#ensureTaskOwner(taskId);
    await this.#delegate.deleteTask(taskId);
    this.#runtime.releaseTask(this.#project, taskId);
  }

  public async forkTask(taskId: string, lastTurnId?: string): Promise<AgentTask> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    const task = await this.#delegate.forkTask(taskId, lastTurnId);
    this.#runtime.claimTask(this.#project, task.id);
    return task;
  }

  public getCapabilities(): Promise<AgentCapabilities> {
    return this.#delegate.getCapabilities();
  }

  public interruptTurn(taskId: string, turnId: string): Promise<void> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    return this.#delegate.interruptTurn(taskId, turnId);
  }

  public async listBackgroundTerminals(taskId: string): Promise<AgentBackgroundTerminalPage> {
    await this.#ensureTaskOwner(taskId);
    return this.#delegate.listBackgroundTerminals(taskId);
  }

  public terminateBackgroundTerminal(taskId: string, terminalId: string): Promise<boolean> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    return this.#delegate.terminateBackgroundTerminal(taskId, terminalId);
  }

  public async unsubscribeTask(taskId: string): Promise<AgentTaskUnsubscribeStatus> {
    if (!this.#runtime.isTaskOwner(this.#project, taskId)) {
      return "notLoaded";
    }
    const status = await this.#delegate.unsubscribeTask(taskId);
    if (status !== "busy") {
      this.#runtime.releaseTask(this.#project, taskId);
    }
    return status;
  }

  public async unarchiveTask(taskId: string): Promise<AgentTask> {
    await this.#ensureTaskOwner(taskId);
    const task = await this.#delegate.unarchiveTask(taskId);
    this.#runtime.claimTask(this.#project, task.id);
    return task;
  }

  public listModels(): Promise<AgentModelPage> {
    return this.#delegate.listModels();
  }

  public async listMcpServers(taskId: string): Promise<AgentMcpServerPage> {
    await this.#ensureTaskOwner(taskId);
    return this.#delegate.listMcpServers(taskId);
  }

  public async reloadMcpServers(taskId: string): Promise<AgentMcpServerPage> {
    await this.#ensureTaskOwner(taskId);
    return this.#delegate.reloadMcpServers(taskId);
  }

  public listSkills(): Promise<AgentSkillPage> {
    return this.#delegate.listSkills();
  }

  public readSandboxMode(): Promise<AgentSandboxMode> {
    return this.#delegate.readSandboxMode();
  }

  public async listTasks(input?: ListAgentTasksInput): Promise<AgentTaskPage> {
    const page = await this.#delegate.listTasks(input);
    for (const task of page.data) {
      this.#runtime.claimTask(this.#project, task.id);
    }
    return page;
  }

  public async readTask(
    taskId: string,
    input?: ReadAgentTaskInput,
  ): Promise<AgentProviderTaskSnapshot | undefined> {
    if (!this.#runtime.beginTaskRead(this.#project, taskId)) {
      return undefined;
    }
    try {
      const snapshot = await this.#delegate.readTask(taskId, input);
      if (snapshot === undefined) {
        this.#runtime.releaseProvisionalTask(this.#project, taskId);
      } else {
        this.#runtime.claimTask(this.#project, taskId);
      }
      return snapshot;
    } catch (error) {
      this.#runtime.releaseProvisionalTask(this.#project, taskId);
      throw error;
    }
  }

  public readTaskAttachment(
    taskId: string,
    attachmentId: string,
  ): Promise<AgentProviderAttachment | undefined> {
    if (!this.#runtime.isTaskOwner(this.#project, taskId)) {
      return Promise.resolve(undefined);
    }
    return this.#delegate.readTaskAttachment(taskId, attachmentId);
  }

  public async renameTask(taskId: string, title: string): Promise<void> {
    await this.#ensureTaskOwner(taskId);
    return this.#delegate.renameTask(taskId, title);
  }

  public async pinTask(taskId: string, pinned: boolean): Promise<AgentTask> {
    await this.#ensureTaskOwner(taskId);
    return this.#delegate.pinTask(taskId, pinned);
  }

  public resolvePendingRequest(input: ResolvePendingRequestInput): Promise<PendingRequest> {
    this.#runtime.assertTaskOwner(this.#project, input.taskId);
    return this.#delegate.resolvePendingRequest(input);
  }

  public startReview(taskId: string, target: AgentReviewTarget): Promise<AgentTurn> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    return this.#delegate.startReview(taskId, target);
  }

  public async startTask(options: StartAgentTaskOptions = {}): Promise<AgentTask> {
    const task = await this.#delegate.startTask(options);
    this.#runtime.claimTask(this.#project, task.id);
    return task;
  }

  public async startTurn(
    taskId: string,
    input: AgentProviderTurnInput,
    options: AgentTurnOptions,
  ): Promise<AgentTurn> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    if (options.fastMode !== true) {
      return this.#delegate.startTurn(taskId, input, options);
    }
    const status = await this.#runtime.readProviderConnection();
    if (isAgentFastModeAvailable(status)) {
      return this.#delegate.startTurn(taskId, input, options);
    }
    // HTTP 输入不可信，非官方账号即使手工提交 fastMode 也必须在 Provider 边界移除。
    const standardOptions = { ...options };
    delete standardOptions.fastMode;
    return this.#delegate.startTurn(taskId, input, standardOptions);
  }

  public steerTurn(taskId: string, turnId: string, input: AgentProviderTurnInput): Promise<void> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    return this.#delegate.steerTurn(taskId, turnId, input);
  }

  public subscribeEvents(
    listener: AgentProviderEventListener,
    options?: AgentProviderEventSubscriptionOptions,
  ): () => void {
    return this.#delegate.subscribeEvents(listener, options);
  }

  public uploadFeedback(taskId: string, input: UploadAgentFeedbackRequest): Promise<void> {
    this.#runtime.assertTaskOwner(this.#project, taskId);
    return this.#delegate.uploadFeedback(taskId, input);
  }

  async #ensureTaskOwner(taskId: string): Promise<void> {
    if (this.#runtime.isTaskOwner(this.#project, taskId)) {
      return;
    }
    // Sidebar 可直接操作已释放的历史 Task，先重新读取并恢复 Project 归属。
    if ((await this.readTask(taskId)) === undefined) {
      throw new CodexProtocolMappingError("Codex thread does not belong to the active project");
    }
  }
}
