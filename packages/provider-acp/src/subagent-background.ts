import type { AgentTurn } from "@codexly/protocol";
import { randomUUID } from "node:crypto";
import type { AgentProviderEventListener } from "@codexly/core";
import { AcpEventProjection } from "./event-projection.js";
import type { AcpHistory } from "./history.js";
import { prepareAcpHistoryCommit } from "./turn-persistence.js";

/** v1 子会话可跨越父 prompt 的响应。后台记录使用现有条目增量，且不改变主回合状态。 */
export class AcpSubagentBackground {
  readonly #active = new Map<string, AcpEventProjection>();
  readonly #saving = new Map<string, Promise<void>>();
  readonly #uncommitted = new Map<
    string,
    {
      turn: AgentTurn;
      write: ReturnType<typeof prepareAcpHistoryCommit>;
    }
  >();
  revision = 0;

  constructor(
    readonly history: AcpHistory,
    readonly emit: AgentProviderEventListener,
    readonly foregroundSettlement: (taskId: string) => Promise<void> | undefined,
  ) {}

  ensure(taskId: string): AcpEventProjection {
    const previous = this.#active.get(taskId);
    if (previous) return previous;
    const projection = new AcpEventProjection(taskId, randomUUID(), this.emit, true);
    this.#active.set(taskId, projection);
    this.emit({
      type: "acp.background.updated",
      taskId,
      turnId: projection.turnId,
      payload: {
        startedAt: this.#snapshot(projection).startedAt ?? new Date().toISOString(),
        completedAt: null,
      },
    });
    return projection;
  }

  #snapshot(projection: AcpEventProjection) {
    return { ...projection.snapshot(), status: "completed" as const, acpBackground: true as const };
  }

  snapshot(taskId: string) {
    const projection = this.#active.get(taskId);
    return projection ? this.#snapshot(projection) : undefined;
  }

  async flush(taskId: string): Promise<void> {
    const previous = this.#saving.get(taskId);
    if (!previous && !this.#active.has(taskId) && !this.#uncommitted.has(taskId)) return;
    const save = async () => {
      await previous?.catch(() => undefined);
      await this.foregroundSettlement(taskId);
      const uncommitted = this.#uncommitted.get(taskId);
      if (uncommitted) {
        const stored = await uncommitted.write();
        this.#uncommitted.delete(taskId);
        this.#publish(taskId, stored);
      }
      const projection = this.#active.get(taskId);
      if (!projection) return;
      const turn = { ...this.#snapshot(projection), completedAt: new Date().toISOString() };
      const write = prepareAcpHistoryCommit(
        () => projection.content.materialize(turn, this.history.cache.content(taskId), taskId),
        (stored) => this.history.append(taskId, stored),
        () => Promise.resolve(),
      );
      // 写入时允许新活动进入新段。快照在事件发布前仍可看到待提交段。
      this.#uncommitted.set(taskId, { turn, write });
      this.#active.delete(taskId);
      const stored = await write();
      this.#uncommitted.delete(taskId);
      this.#publish(taskId, stored);
    };
    const saving = save();
    this.#saving.set(taskId, saving);
    try {
      await saving;
    } finally {
      if (this.#saving.get(taskId) === saving) this.#saving.delete(taskId);
    }
  }

  snapshots(taskId: string) {
    return [this.#uncommitted.get(taskId)?.turn, this.snapshot(taskId)].flatMap(
      (turn) => turn ?? [],
    );
  }

  #publish(taskId: string, turn: AgentTurn) {
    this.revision++;
    this.emit({
      type: "acp.background.updated",
      taskId,
      turnId: turn.id,
      payload: {
        startedAt: turn.startedAt ?? new Date().toISOString(),
        completedAt: turn.completedAt,
      },
    });
  }

  async close() {
    await Promise.all(
      [...new Set([...this.#active.keys(), ...this.#uncommitted.keys()])].map((id) =>
        this.flush(id),
      ),
    );
  }
}
