import { Buffer } from "node:buffer";
import type {
  AgentProviderQueue,
  AgentProviderTurnInput,
  ListAgentQueuedSubmissionsInput,
} from "@codexly/core";
import type {
  AgentQueuedSubmission,
  AgentQueuedSubmissionPage,
  AgentTurn,
} from "@codexly/protocol";

import { CodexAgentProviderBase } from "./agent-provider-base.js";
import { createCodexFileTextInput } from "./codex-file-input.js";
import { mapUserMessageContent } from "./codex-message-mapping.js";
import {
  CodexProtocolMappingError,
  expectBoolean,
  expectRecord,
  expectString,
  mapAgentTurn,
} from "./codex-protocol-mapping.js";

export abstract class CodexAgentProviderQueue extends CodexAgentProviderBase {
  public readonly queue: AgentProviderQueue = {
    add: (taskId, input, clientUserMessageId) =>
      this.addQueuedSubmission(taskId, input, clientUserMessageId),
    delete: (taskId, queuedSubmissionId) => this.deleteQueuedSubmission(taskId, queuedSubmissionId),
    list: (taskId, input) => this.listQueuedSubmissions(taskId, input),
    reorder: (taskId, queuedSubmissionIds) =>
      this.reorderQueuedSubmissions(taskId, queuedSubmissionIds),
    start: (taskId, queuedSubmissionId) => this.startQueuedSubmission(taskId, queuedSubmissionId),
    update: (taskId, queuedSubmissionId, input) =>
      this.updateQueuedSubmission(taskId, queuedSubmissionId, input),
  };

  protected async mapTurnInput(input: AgentProviderTurnInput) {
    if (input.skills.some((skill) => !this.skillsById.has(skill.id))) {
      await this.listSkills();
    }
    const skills = input.skills.map((reference) => {
      const skill = this.skillsById.get(reference.id);
      if (skill?.name !== reference.name) {
        throw new CodexProtocolMappingError("Provider turn skill is unavailable");
      }
      return { name: skill.name, path: skill.path, type: "skill" as const };
    });
    const images = input.images.map((image) => {
      if (!image.url.startsWith(`data:${image.mediaType};base64,`)) {
        throw new CodexProtocolMappingError("Provider image URL does not match its media type");
      }
      return { type: "image" as const, url: image.url };
    });
    const files = input.files.map(createCodexFileTextInput);
    const textAttachments = input.textAttachments.map((attachment) => ({
      text: attachment.text,
      text_elements: [
        {
          byteRange: { end: Buffer.byteLength(attachment.text, "utf8"), start: 0 },
          placeholder: attachment.name,
        },
      ],
      type: "text" as const,
    }));
    const skillIndexText =
      input.text.length === 0 && skills.length > 0
        ? skills.map((skill) => `$${skill.name}`).join(" ")
        : undefined;
    const codexInput = [
      // Codex 只索引文本输入；纯 Skill Turn 需要可恢复的命令文本。
      ...(skillIndexText === undefined
        ? []
        : [{ text: skillIndexText, text_elements: [], type: "text" as const }]),
      ...skills,
      ...(input.text.length === 0
        ? []
        : [{ text: input.text, text_elements: [], type: "text" as const }]),
      ...textAttachments,
      ...files,
      ...images,
    ];
    if (codexInput.length === 0) {
      throw new CodexProtocolMappingError("Provider turn input must not be empty");
    }
    return codexInput;
  }

  private async mapQueuedSubmission(
    taskId: string,
    value: unknown,
  ): Promise<AgentQueuedSubmission> {
    const queued = expectRecord(value, "thread queue submission");
    const content = mapUserMessageContent(
      queued["input"],
      (part, imageIndex) => this.mapMessageImage(taskId, part, imageIndex),
      (input, textIndex) => this.mapMessageText(taskId, input, textIndex),
    );
    if (content.skills.length > 0 && this.skillsById.size === 0) {
      await this.listSkills();
    }
    const skills = content.skills.map((queuedSkill) => {
      const skill = [...this.skillsById.values()].find(
        (candidate) => candidate.name === queuedSkill.name,
      );
      if (skill === undefined) {
        throw new CodexProtocolMappingError("Queued Codex skill is unavailable");
      }
      return { id: skill.id, name: skill.name };
    });
    return {
      attachments: content.attachments,
      clientUserMessageId: expectString(
        queued["clientUserMessageId"],
        "thread queue client user message id",
      ),
      id: expectString(queued["id"], "thread queue submission id"),
      skills,
      text: content.text,
    };
  }

  private async addQueuedSubmission(
    taskId: string,
    input: AgentProviderTurnInput,
    clientUserMessageId: string,
  ): Promise<AgentQueuedSubmission> {
    this.assertKnownProjectTask(taskId);
    const response = expectRecord(
      await this.client.request("thread/queue/add", {
        clientUserMessageId,
        input: await this.mapTurnInput(input),
        threadId: taskId,
      }),
      "thread/queue/add response",
    );
    return this.mapQueuedSubmission(taskId, response["queuedSubmission"]);
  }

  private async listQueuedSubmissions(
    taskId: string,
    input: ListAgentQueuedSubmissionsInput = {},
  ): Promise<AgentQueuedSubmissionPage> {
    this.assertKnownProjectTask(taskId);
    const response = expectRecord(
      await this.client.request("thread/queue/list", {
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        threadId: taskId,
      }),
      "thread/queue/list response",
    );
    const data = response["data"];
    if (!Array.isArray(data)) {
      throw new CodexProtocolMappingError("thread/queue/list data must be an array");
    }
    const nextCursor = response["nextCursor"];
    if (nextCursor !== null && typeof nextCursor !== "string") {
      throw new CodexProtocolMappingError("thread/queue/list next cursor is invalid");
    }
    return {
      data: await Promise.all(data.map((item) => this.mapQueuedSubmission(taskId, item))),
      nextCursor,
    };
  }

  private async updateQueuedSubmission(
    taskId: string,
    queuedSubmissionId: string,
    input: AgentProviderTurnInput,
  ): Promise<AgentQueuedSubmission> {
    this.assertKnownProjectTask(taskId);
    const response = expectRecord(
      await this.client.request("thread/queue/update", {
        input: await this.mapTurnInput(input),
        queuedSubmissionId,
        threadId: taskId,
      }),
      "thread/queue/update response",
    );
    return this.mapQueuedSubmission(taskId, response["queuedSubmission"]);
  }

  private async deleteQueuedSubmission(
    taskId: string,
    queuedSubmissionId: string,
  ): Promise<boolean> {
    this.assertKnownProjectTask(taskId);
    const response = expectRecord(
      await this.client.request("thread/queue/delete", { queuedSubmissionId, threadId: taskId }),
      "thread/queue/delete response",
    );
    return expectBoolean(response["deleted"], "thread/queue/delete deleted");
  }

  private async reorderQueuedSubmissions(
    taskId: string,
    queuedSubmissionIds: readonly string[],
  ): Promise<void> {
    this.assertKnownProjectTask(taskId);
    expectRecord(
      await this.client.request("thread/queue/reorder", {
        queuedSubmissionIds: [...queuedSubmissionIds],
        threadId: taskId,
      }),
      "thread/queue/reorder response",
    );
  }

  private async startQueuedSubmission(
    taskId: string,
    queuedSubmissionId?: string,
  ): Promise<AgentTurn> {
    this.assertKnownProjectTask(taskId);
    await this.resumeTask(taskId);
    const response = expectRecord(
      await this.client.request("thread/queue/start", {
        ...(queuedSubmissionId === undefined ? {} : { queuedSubmissionId }),
        threadId: taskId,
      }),
      "thread/queue/start response",
    );
    const turn = mapAgentTurn(
      response["turn"],
      (part, imageIndex) => this.mapMessageImage(taskId, part, imageIndex),
      (input, textIndex) => this.mapMessageText(taskId, input, textIndex),
    );
    if (turn.status === "running") {
      this.runtime.runningTaskIds.add(taskId);
    }
    return turn;
  }
}
