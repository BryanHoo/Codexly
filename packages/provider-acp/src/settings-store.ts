import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import type { AgentEngine } from "@codexly/protocol";
import {
  AcpConfigValuesSchema,
  AcpSettingsMigrationSchema,
  AcpProviderConfigSchema,
} from "@codexly/protocol";
import { Type, type Static } from "@sinclair/typebox";
import type { AcpStorageLeases } from "./storage-lease.js";

export const StoredSchema = Type.Object({
  version: Type.Literal(1),
  configured: Type.Boolean(),
  values: AcpConfigValuesSchema,
  // 当前 agent 不再公布的选项只留在私有记录；与默认值共用 512 KiB 存储预算。
  retainedValues: Type.Optional(AcpConfigValuesSchema),
  legacy: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  // 原生配置已覆盖的应用旧副本只归档，不能重新成为新会话默认值。
  legacyPolicy: Type.Optional(Type.Literal("preserve")),
  migration: Type.Optional(AcpSettingsMigrationSchema),
  providers: Type.Optional(Type.Record(Type.String(), AcpProviderConfigSchema)),
  disabledProviders: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 128, uniqueItems: true }),
  ),
});
export type AcpStoredSettings = Static<typeof StoredSchema>;
/** 来源声明旧值是否仍有效；被原生配置覆盖的副本只归档，不能重新参与默认值映射。 */
export interface AcpLegacySettingsSnapshot {
  settings: Record<string, unknown>;
  policy: "migrate" | "preserve";
}
export type AcpLegacySettingsSource = (engine: AgentEngine) => Promise<AcpLegacySettingsSnapshot>;
const empty = (): AcpStoredSettings => ({ version: 1, configured: false, values: {} });
/** 文件仅存应用默认值与私有迁移凭据；禁止把 legacy 整体返回到客户端。 */
export class AcpSettingsStore {
  readonly #imports = new Map<AgentEngine, Promise<AcpStoredSettings>>();
  constructor(
    readonly directory: string,
    readonly legacySource?: AcpLegacySettingsSource,
    readonly leases?: AcpStorageLeases,
  ) {}
  async read(engine: AgentEngine): Promise<AcpStoredSettings> {
    const current = await this.#read(engine);
    const source = this.legacySource;
    // 用户已经明确保存的新默认值不再依赖旧来源可读；损坏的旧文件不能阻断现有 ACP 配置。
    if (current.configured || current.legacy !== undefined || !source) return current;
    const existing = this.#imports.get(engine);
    if (existing) return existing;
    // 首读只采集应用自有旧值；并发读取共用一次来源，失败不能写入空的迁移标记。
    const pending = (async () => {
      const snapshot = await source(engine);
      await this.importLegacy(engine, snapshot.settings, snapshot.policy);
      return this.#read(engine);
    })();
    this.#imports.set(engine, pending);
    try {
      return await pending;
    } finally {
      if (this.#imports.get(engine) === pending) this.#imports.delete(engine);
    }
  }
  async #read(engine: AgentEngine): Promise<AcpStoredSettings> {
    const path = join(this.directory, `${engine}.json`);
    let text: string;
    try {
      if ((await stat(path)).size > 512 * 1024) throw new Error("ACP 设置超出存储预算");
      text = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
      throw error;
    }
    const data: unknown = JSON.parse(text);
    if (!Value.Check(StoredSchema, data)) throw new Error("ACP 设置文件无效，保留原文件供恢复");
    return data;
  }
  async update(
    engine: AgentEngine,
    change: (current: AcpStoredSettings) => AcpStoredSettings,
  ): Promise<AcpStoredSettings> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, `${engine}.json`);
    // 两个宿主同时修改时明确报忙；持锁期间重新读取，避免用旧快照覆盖另一端选择。
    // 生产宿主共用数据库原子锁；规范化目录，符号链接入口不能绕过同一资源锁。
    const release = this.leases
      ? await this.leases.acquire(
          `settings:${join(await realpath(this.directory), `${engine}.json`)}`,
        )
      : await this.#fileLock(path);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      // 持锁重读原记录，不递归触发首读导入；保留另一宿主已保存的新选择或旧快照。
      const next = change(await this.#read(engine));
      const data = JSON.stringify(next);
      if (Buffer.byteLength(data) > 512 * 1024) throw new Error("ACP 设置超出存储预算");
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(data);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, path);
      return next;
    } finally {
      try {
        await rm(temporary, { force: true });
      } finally {
        await release();
      }
    }
  }
  /** 独立文件存储调用仍保留原互斥语义；生产 Runtime 必须注入共享目录锁。 */
  async #fileLock(path: string): Promise<() => Promise<void>> {
    const lock = await open(`${path}.lock`, "wx", 0o600);
    return async () => {
      try {
        await lock.close();
      } finally {
        await rm(`${path}.lock`, { force: true });
      }
    };
  }
  async importLegacy(
    engine: AgentEngine,
    legacy: Record<string, unknown>,
    policy: AcpLegacySettingsSnapshot["policy"] = "migrate",
  ): Promise<void> {
    await this.update(engine, (current) =>
      current.legacy
        ? current
        : {
            ...current,
            legacy: structuredClone(legacy),
            ...(policy === "preserve" ? { legacyPolicy: policy } : {}),
          },
    );
  }
}
