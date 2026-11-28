import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  AcpSettingsSnapshotSchema,
  type AcpSettingsSnapshot,
  type AgentEngine,
} from "@codexly/protocol";
import { waitForAcpPreview } from "./config-preview.js";
import type { AcpStorageLeases } from "./storage-lease.js";

const diskSchema = Type.Object({
  version: Type.Literal(1),
  binding: Type.String(),
  snapshot: AcpSettingsSnapshotSchema,
});
const MAX_BYTES = 2 * 1024 * 1024;
const REFRESH_TIMEOUT_MS = 38_000;

/** 设置快照记录上次成功的已脱敏结果。实时检测失败时，保留可读的磁盘快照。 */
export class AcpSettingsSnapshots {
  readonly #active = new Map<
    AgentEngine,
    { stop: AbortController; result: Promise<AcpSettingsSnapshot>; readers: number }
  >();
  #closed = false;

  constructor(
    private readonly directory: string,
    private readonly binding: (engine: AgentEngine) => Promise<string>,
    private readonly probe: (
      engine: AgentEngine,
      signal: AbortSignal,
    ) => Promise<AcpSettingsSnapshot>,
    private readonly leases?: AcpStorageLeases,
  ) {}

  async read(engine: AgentEngine): Promise<AcpSettingsSnapshot | null> {
    const path = join(this.directory, engine + ".json");
    try {
      const [binding, info] = await Promise.all([this.binding(engine), stat(path)]);
      if (info.size > MAX_BYTES) return null;
      const input: unknown = JSON.parse(await readFile(path, "utf8"));
      return Value.Check(diskSchema, input) &&
        input.binding === binding &&
        input.snapshot.profile.engine === engine
        ? input.snapshot
        : null;
    } catch {
      return null;
    }
  }

  async refresh(engine: AgentEngine, signal?: AbortSignal): Promise<AcpSettingsSnapshot> {
    if (this.#closed) throw new Error("ACP 设置快照服务已关闭");
    signal?.throwIfAborted();
    let pending = this.#active.get(engine);
    if (!pending || pending.stop.signal.aborted) {
      const stop = new AbortController();
      const deadline = AbortSignal.any([stop.signal, AbortSignal.timeout(REFRESH_TIMEOUT_MS)]);
      const result = waitForAcpPreview(this.#refresh(engine, deadline), deadline).finally(() => {
        if (this.#active.get(engine)?.stop === stop) this.#active.delete(engine);
      });
      pending = { stop, result, readers: 0 };
      this.#active.set(engine, pending);
    }
    pending.readers++;
    try {
      return await waitForAcpPreview(pending.result, signal);
    } finally {
      // 切走页面只结束自己的等待，最后一个观察者离开时才回收探测。
      if (--pending.readers === 0) pending.stop.abort();
    }
  }

  async invalidate(engine: AgentEngine): Promise<void> {
    this.#active.get(engine)?.stop.abort();
    const release = await this.leases?.acquire("acp-settings-snapshot:" + engine);
    try {
      await rm(join(this.directory, engine + ".json"), { force: true });
    } finally {
      await release?.();
    }
  }

  close(): void {
    this.#closed = true;
    for (const { stop } of this.#active.values()) stop.abort();
  }

  async #refresh(engine: AgentEngine, signal: AbortSignal) {
    const binding = await this.binding(engine);
    signal.throwIfAborted();
    const snapshot = await this.probe(engine, signal);
    signal.throwIfAborted();
    // 凭据、供应商或默认值变化后，迟到的探测结果不能覆盖新设置。
    if ((await this.binding(engine)) !== binding) throw new Error("ACP 设置已变化，请重新检测");
    await this.#write(engine, binding, snapshot, signal).catch(() => undefined);
    signal.throwIfAborted();
    return snapshot;
  }

  async #write(
    engine: AgentEngine,
    binding: string,
    snapshot: AcpSettingsSnapshot,
    signal: AbortSignal,
  ) {
    const entry = { version: 1, binding, snapshot };
    const body = JSON.stringify(entry);
    if (Buffer.byteLength(body) > MAX_BYTES || !Value.Check(diskSchema, entry)) return;
    const release = await this.leases?.acquire("acp-settings-snapshot:" + engine);
    try {
      if (signal.aborted || (await this.binding(engine)) !== binding) return;
      const previous = await this.read(engine);
      if (JSON.stringify(previous) === JSON.stringify(snapshot)) return;
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const path = join(this.directory, engine + ".json");
      const temporary = path + "." + randomUUID() + ".tmp";
      try {
        await writeFile(temporary, body, { flag: "wx", mode: 0o600 });
        signal.throwIfAborted();
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
    } finally {
      await release?.();
    }
  }
}
