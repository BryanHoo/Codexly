import {
  isAgentEngine,
  AgentEngineSchema,
  AcpConfigValuesSchema,
  type AcpConfigOption,
} from "@codexly/protocol";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { LocalTask } from "@codexly/core";
import { StoredSchema, type AcpSettingsStore } from "./settings-store.js";
import type { AcpStorageLeases } from "./storage-lease.js";

const RecordSchema = Type.Object(
  {
    version: Type.Literal(1),
    taskId: Type.String(),
    provider: AgentEngineSchema,
    projectId: Type.Union([Type.String(), Type.Null()]),
    cwd: Type.String(),
    sessionId: Type.String({ minLength: 1 }),
    phase: Type.Union([Type.Literal("pending"), Type.Literal("done")]),
    firstPromptUnsent: Type.Optional(Type.Literal(true)),
    replacesSessionId: Type.Optional(Type.String({ minLength: 1 })),
    settings: Type.Optional(StoredSchema),
    configuration: Type.Optional(AcpConfigValuesSchema),
  },
  { additionalProperties: false },
);
type Initialization = Static<typeof RecordSchema>;

/** 原生绑定先写恢复意图再发布到任务目录；默认值冻结到首次创建时，不在重启后偷换。 */
export class AcpSessionInitialization {
  constructor(
    readonly directory: string,
    readonly settings: AcpSettingsStore,
    readonly leases: AcpStorageLeases,
  ) {}
  #path(id: string): string {
    return join(this.directory, `${createHash("sha256").update(id).digest("hex")}.json`);
  }
  async read(task: LocalTask): Promise<Initialization | undefined> {
    let value: unknown;
    try {
      const path = this.#path(task.id);
      if ((await stat(path)).size > 576 * 1024) throw new Error("ACP 初始化记录超过预算");
      value = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    if (
      !Value.Check(RecordSchema, value) ||
      value.taskId !== task.id ||
      value.provider !== task.provider ||
      value.projectId !== task.projectId ||
      value.cwd !== task.cwd ||
      (task.sessionId !== null &&
        value.sessionId !== task.sessionId &&
        value.replacesSessionId !== task.sessionId) ||
      ((value.phase === "pending" || value.firstPromptUnsent) && !value.settings)
    )
      throw new Error("ACP 初始化身份或配置无效，保留原记录供恢复");
    return value;
  }
  async #locked<T>(id: string, action: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const release = await this.leases.acquire(
      `session:${join(await realpath(this.directory), createHash("sha256").update(id).digest("hex"))}`,
    );
    try {
      return await action();
    } finally {
      await release();
    }
  }
  async #write(id: string, value: Initialization): Promise<void> {
    const bytes = JSON.stringify(value);
    if (Buffer.byteLength(bytes) > 576 * 1024) throw new Error("ACP 初始化记录超过预算");
    const path = this.#path(id),
      temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  async prepare(task: LocalTask, sessionId: string): Promise<void> {
    if (!isAgentEngine(task.provider)) throw new Error("未知 ACP 引擎");
    const provider = task.provider;
    await this.#locked(task.id, async () => {
      const previous = await this.read(task);
      if (previous) {
        if (previous.sessionId !== sessionId) throw new Error("ACP 初始化会话身份冲突");
        return;
      }
      await this.#write(task.id, {
        version: 1,
        taskId: task.id,
        provider,
        projectId: task.projectId,
        cwd: task.cwd,
        sessionId,
        phase: "pending",
        ...(provider === "codex" ? { firstPromptUnsent: true } : {}),
        settings: await this.settings.read(provider),
      });
    });
  }
  async complete(task: LocalTask, sessionId: string): Promise<void> {
    await this.#locked(task.id, async () => {
      const previous = await this.read(task);
      if (!previous) return;
      if (previous.sessionId !== sessionId) throw new Error("ACP 初始化会话身份冲突");
      if (previous.phase === "done") return;
      // Codex 的空会话可能在首发前丢失，这时仍需用首次冻结的默认值重建。
      if (previous.firstPromptUnsent) {
        await this.#write(task.id, { ...previous, phase: "done" });
        return;
      }
      const { settings: _settings, ...binding } = previous;
      await this.#write(task.id, { ...binding, phase: "done" });
    });
  }
  /** 保存 Agent 已确认的任务配置，与仅用于新会话的全局默认值独立。 */
  async saveConfiguration(
    task: LocalTask,
    sessionId: string,
    options: AcpConfigOption[],
  ): Promise<void> {
    if (!isAgentEngine(task.provider)) throw new Error("未知 ACP 引擎");
    const provider = task.provider;
    await this.#locked(task.id, async () => {
      const previous = await this.read(task);
      if (previous && previous.sessionId !== sessionId) throw new Error("ACP 初始化会话身份冲突");
      // Agent 暂时不公布的配置仍保留，后续恢复时可以重新匹配。
      const configuration = {
        ...previous?.configuration,
        ...Object.fromEntries(options.map((option) => [option.id, option.currentValue])),
      };
      if (JSON.stringify(previous?.configuration) === JSON.stringify(configuration)) return;
      await this.#write(task.id, {
        version: 1,
        taskId: task.id,
        provider,
        projectId: task.projectId,
        cwd: task.cwd,
        sessionId,
        phase: "done",
        ...previous,
        configuration,
      });
    });
  }
  async markFirstPrompt(task: LocalTask, sessionId: string): Promise<void> {
    const record = await this.read(task);
    if (record && record.sessionId !== sessionId) throw new Error("ACP 初始化会话身份冲突");
    if (!record?.firstPromptUnsent) return;
    await this.#locked(task.id, async () => {
      const current = await this.read(task);
      if (current?.sessionId !== sessionId) throw new Error("ACP 初始化会话身份冲突");
      if (!current.firstPromptUnsent) return;
      // 必须先持久化再发 prompt；即使发送回执丢失，也不能再把此会话当作空会话替换。
      const { firstPromptUnsent: _unsent, settings: _settings, ...binding } = current;
      await this.#write(task.id, { ...binding, phase: "done" });
    });
  }
  async replaceUnsent(
    task: LocalTask,
    sessionId: string,
    hasHistory: () => Promise<boolean>,
    create: () => Promise<string>,
  ): Promise<string | undefined> {
    return this.#locked(task.id, async () => {
      const current = await this.read(task);
      if (current?.sessionId !== sessionId || !current.firstPromptUnsent || (await hasHistory()))
        return undefined;
      const replacement = await create();
      // 先写替换意图，再发布任务绑定。两次写入之间崩溃时，旧目录身份仍可恢复到新会话。
      await this.#write(task.id, {
        ...current,
        sessionId: replacement,
        replacesSessionId: sessionId,
        phase: "pending",
      });
      return replacement;
    });
  }
  async deleteTask(id: string): Promise<void> {
    await this.#locked(id, () => rm(this.#path(id), { force: true }));
  }
}
