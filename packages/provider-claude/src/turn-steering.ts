import { randomUUID } from "node:crypto";
import type { AgentProviderTurnInput } from "@codexly/core";
import type { ClaudeConfiguration } from "./config.js";
import { createClaudePrompt } from "./turn-input.js";
import { checkpoint, type Running } from "./session.js";

/** 引导保留当前 Query 的生命周期，跨端共用附件准备及目标回合检查。 */
export class ClaudeTurnSteering {
  readonly #pending = new Map<string, Promise<void>>();
  constructor(
    readonly current: (id: string) => Running | undefined,
    readonly configuration: ClaudeConfiguration,
  ) {}
  /** 同一任务串行准备引导，保留提交顺序；异步附件处理后重新校验目标回合。 */
  async send(id: string, turnId: string, input: AgentProviderTurnInput): Promise<void> {
    const previous = this.#pending.get(id) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        const running = this.current(id);
        const validate = () => {
          if (
            !running ||
            running.closed ||
            running.settling ||
            this.current(id) !== running ||
            running.projection.id !== turnId ||
            running.projection.status !== "running" ||
            running.interruptedTurnId === turnId
          )
            throw new Error("Claude 目标回合已结束，无法接收引导");
        };
        validate();
        if (!running) throw new Error("Claude 会话不存在");
        if (input.skills.length || input.outputSchema || /^\s*\//u.test(input.text))
          throw new Error("Claude 引导只接受普通消息与附件");
        const messageId = randomUUID();
        const message = await createClaudePrompt(input, running.sessionId, messageId);
        const attachments = await this.configuration.attachments.prepare(id, input);
        validate();
        // next 在工具边界进入原回合；不使用 interrupt，也不把引导变成普通排队。
        running.input.send({ ...message, priority: "next" });
        running.projection.addUserInput(messageId, { text: input.text, attachments });
        await checkpoint(id, running.projection, this.configuration);
      });
    this.#pending.set(id, operation);
    try {
      await operation;
    } finally {
      if (this.#pending.get(id) === operation) this.#pending.delete(id);
    }
  }
}
