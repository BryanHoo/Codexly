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
    provider: Type.Union([Type.Literal("codex"), Type.Literal("claude")]),
    projectId: Type.Union([Type.String(), Type.Null()]),
    cwd: Type.String(),
    sessionId: Type.String({ minLength: 1 }),
    phase: Type.Union([Type.Literal("pending"), Type.Literal("done")]),
    settings: Type.Optional(StoredSchema),
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
      (task.sessionId !== null && value.sessionId !== task.sessionId) ||
      (value.phase === "pending" && !value.settings)
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
    if (task.provider !== "codex" && task.provider !== "claude") throw new Error("未知 ACP 引擎");
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
      // 完成后只保留小型绑定锚点，不长期复制含私有供应商头的默认设置快照。
      const { settings: _settings, ...binding } = previous;
      await this.#write(task.id, { ...binding, phase: "done" });
    });
  }
  async deleteTask(id: string): Promise<void> {
    await this.#locked(id, () => rm(this.#path(id), { force: true }));
  }
}
