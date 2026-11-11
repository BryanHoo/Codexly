import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import type { AgentEngine } from "@codexly/protocol";
import {
  AcpConfigValuesSchema,
  AcpSettingsMigrationSchema,
  AcpProviderConfigSchema,
} from "@codexly/protocol";
import { Type, type Static } from "@sinclair/typebox";

const StoredSchema = Type.Object({
  version: Type.Literal(1),
  configured: Type.Boolean(),
  values: AcpConfigValuesSchema,
  // 当前 agent 不再公布的选项只留在私有记录；与默认值共用 512 KiB 存储预算。
  retainedValues: Type.Optional(AcpConfigValuesSchema),
  legacy: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  migration: Type.Optional(AcpSettingsMigrationSchema),
  providers: Type.Optional(Type.Record(Type.String(), AcpProviderConfigSchema)),
  disabledProviders: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 128, uniqueItems: true }),
  ),
});
export type AcpStoredSettings = Static<typeof StoredSchema>;
const empty = (): AcpStoredSettings => ({ version: 1, configured: false, values: {} });
/** 文件仅存应用默认值与私有迁移凭据；禁止把 legacy 整体返回到客户端。 */
export class AcpSettingsStore {
  constructor(readonly directory: string) {}
  async read(engine: AgentEngine): Promise<AcpStoredSettings> {
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
    const lock = await open(`${path}.lock`, "wx", 0o600);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const next = change(await this.read(engine));
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
      await rm(temporary, { force: true });
      await lock.close();
      await rm(`${path}.lock`, { force: true });
    }
  }
  async importLegacy(engine: AgentEngine, legacy: Record<string, unknown>): Promise<void> {
    await this.update(engine, (current) =>
      current.legacy ? current : { ...current, legacy: structuredClone(legacy) },
    );
  }
}
