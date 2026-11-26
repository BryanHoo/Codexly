import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  opendir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { AcpStorageLeases } from "./storage-lease.js";
import { HistoricalTaskAttachments } from "@codexly/core/task-attachments";

export const ACP_HISTORY_CACHE_BYTES = 256 * 1024 * 1024;
const generationFile = /^[a-f0-9-]{36}\.(jsonl|tmp)$/;
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
const busy = (error: unknown) => (error as NodeJS.ErrnoException).code === "EBUSY";

/** 只管理可重放的展示正文；原厂会话、任务目录和应用独有附件不属于缓存。 */
export class AcpHistoryCache {
  readonly #users = new Map<string, Promise<{ count: number; release: () => Promise<void> }>>();
  #startup: Promise<void> | undefined;
  #disconnected = false;
  constructor(
    readonly directory: string,
    readonly leases?: AcpStorageLeases,
    readonly maxBytes = ACP_HISTORY_CACHE_BYTES,
  ) {}
  #root(task: string): string {
    return join(this.directory, createHash("sha256").update(task).digest("hex"));
  }
  /** 可由 Agent 重建的大正文独立于用户附件，随所属会话缓存一并回收。 */
  content(task: string): HistoricalTaskAttachments {
    return new HistoricalTaskAttachments(join(this.#root(task), "content-attachments"));
  }
  async #lease(root: string, writer = false): Promise<() => Promise<void>> {
    await mkdir(root, { recursive: true, mode: 0o700 });
    if (this.leases) {
      const release = await this.leases.acquire(
        `${writer ? "history" : "history-cache"}:${await realpath(root)}`,
      );
      return async () => {
        if (!this.#disconnected) await release();
      };
    }
    // 生产使用可恢复的 SQLite owner CAS；独立存储调用保留文件锁兼容路径。
    const path = join(root, writer ? "writer.lock" : "cache.lock");
    const file = await open(path, "wx", 0o600).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw Object.assign(new Error("ACP 历史缓存正在使用"), { code: "EBUSY" });
      throw error;
    });
    return async () => {
      await file.close();
      await rm(path, { force: true });
    };
  }
  /** 持有到视图退订/运行结束，避免另一端回收分页、导出或正在执行的会话。 */
  async acquire(task: string): Promise<() => Promise<void>> {
    // 首次使用先回收上次退出遗留的可重放缓存，不为应用启动增加后台计时器。
    if (this.#disconnected) throw new Error("ACP 历史缓存已关闭");
    const startup = (this.#startup ??= this.prune());
    try {
      await startup;
    } catch (error) {
      if (this.#startup === startup) this.#startup = undefined;
      throw error;
    }
    let pending = this.#users.get(task);
    if (!pending) {
      pending = this.#lease(this.#root(task)).then((release) => ({ count: 0, release }));
      this.#users.set(task, pending);
    }
    let user;
    try {
      user = await pending;
    } catch (error) {
      if (this.#users.get(task) === pending) this.#users.delete(task);
      throw error;
    }
    user.count++;
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      if (--user.count) return;
      // 同一 Runtime 的视图与搜索可以共享保护，不放开其他进程的互斥。
      this.#users.delete(task);
      if (this.#disconnected && this.leases) return;
      try {
        await this.touch(task);
      } finally {
        await user.release();
      }
    };
  }
  /** 原生反向目录通道已断开；保留 owner 证据，由下一宿主确认本进程退出后接管。 */
  disconnect(): void {
    this.#disconnected = true;
  }
  async wasEvicted(task: string): Promise<boolean> {
    try {
      await stat(join(this.#root(task), "cache-evicted"));
      return true;
    } catch (error) {
      if (missing(error)) return false;
      throw error;
    }
  }
  rebuilt(task: string): Promise<void> {
    return rm(join(this.#root(task), "cache-evicted"), { force: true });
  }
  async setReplayable(task: string, replayable: boolean): Promise<void> {
    const root = this.#root(task);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const temporary = join(root, `${randomUUID()}.policy.tmp`);
    try {
      await writeFile(temporary, JSON.stringify({ replayable, accessedAt: Date.now() }), {
        mode: 0o600,
      });
      await rename(temporary, join(root, "cache-policy.json"));
    } finally {
      await rm(temporary, { force: true });
    }
  }
  async #policy(root: string): Promise<{ replayable: boolean; accessedAt: number } | undefined> {
    try {
      const path = join(root, "cache-policy.json");
      if ((await stat(path)).size > 1024) return undefined;
      const value = JSON.parse(await readFile(path, "utf8")) as {
        replayable?: unknown;
        accessedAt?: unknown;
      };
      if (
        typeof value.replayable !== "boolean" ||
        typeof value.accessedAt !== "number" ||
        !Number.isFinite(value.accessedAt)
      )
        return undefined;
      return { replayable: value.replayable, accessedAt: value.accessedAt };
    } catch (error) {
      // 未知、旧版或损坏的策略均不构成“可以删除唯一历史”的证据。
      if (missing(error) || error instanceof SyntaxError) return undefined;
      throw error;
    }
  }
  async touch(task: string): Promise<void> {
    const policy = await this.#policy(this.#root(task));
    if (policy) await this.setReplayable(task, policy.replayable);
  }
  async #files(root: string): Promise<{ names: string[]; bytes: number }> {
    const names: string[] = [];
    let bytes = 0;
    for await (const entry of await opendir(root)) {
      if (entry.isFile() && generationFile.test(entry.name)) {
        try {
          bytes += (await stat(join(root, entry.name))).size;
          names.push(entry.name);
        } catch (error) {
          if (!missing(error)) throw error;
        }
      }
    }
    bytes += await this.#contentBytes(join(root, "content-attachments"));
    return { names, bytes };
  }
  async #contentBytes(root: string, depth = 0): Promise<number> {
    let entries;
    try {
      entries = await opendir(root);
    } catch (error) {
      if (missing(error)) return 0;
      throw error;
    }
    let bytes = 0;
    for await (const entry of entries) {
      const path = join(root, entry.name);
      // 仓储只有 blobs/references/task-hash 三层；不跟随链接，不读取附件正文。
      if (entry.isDirectory() && depth < 3) bytes += await this.#contentBytes(path, depth + 1);
      else if (entry.isFile()) {
        try {
          bytes += (await stat(path)).size;
        } catch (error) {
          if (!missing(error)) throw error;
        }
      }
    }
    return bytes;
  }
  /** 仅在会话释放/宿主启动时扫描小策略和文件大小，绝不扫描聊天正文或逐 Token 维护。 */
  async prune(): Promise<void> {
    if (this.#disconnected) return;
    try {
      await stat(this.directory);
    } catch (error) {
      // 仅目录操作或临时辅助生成从未创建历史时，不为退出清理申请数据库锁。
      if (missing(error)) return;
      throw error;
    }
    let release: () => Promise<void>;
    try {
      release = await this.#lease(join(this.directory, "cache-maintenance"));
    } catch (error) {
      if (busy(error)) return;
      throw error;
    }
    try {
      const candidates: { root: string; accessedAt: number; bytes: number }[] = [];
      let total = 0;
      for await (const entry of await opendir(this.directory)) {
        if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
        const root = join(this.directory, entry.name);
        const policy = await this.#policy(root);
        if (!policy?.replayable) continue;
        const { bytes } = await this.#files(root);
        total += bytes;
        if (bytes) candidates.push({ root, accessedAt: policy.accessedAt, bytes });
      }
      candidates.sort((a, b) => a.accessedAt - b.accessedAt);
      for (const candidate of candidates) {
        if (total <= this.maxBytes) break;
        let unlock: () => Promise<void>;
        try {
          unlock = await this.#lease(candidate.root);
        } catch (error) {
          if (busy(error)) continue;
          throw error;
        }
        try {
          const policy = await this.#policy(candidate.root);
          // 扫描期间另一端可能重新协商能力或访问任务，不能依据过期候选删除。
          if (!policy?.replayable || policy.accessedAt !== candidate.accessedAt) continue;
          let writer: () => Promise<void>;
          try {
            writer = await this.#lease(candidate.root, true);
          } catch (error) {
            if (busy(error)) continue;
            throw error;
          }
          try {
            const files = await this.#files(candidate.root);
            // 先留下缺失证据；即使会话仍暖绑定，下次读取也必须重放，不能只 resume。
            await writeFile(join(candidate.root, "cache-evicted"), "", { mode: 0o600 });
            await rm(join(candidate.root, "current"), { force: true });
            for (const name of files.names) await rm(join(candidate.root, name), { force: true });
            await rm(join(candidate.root, "content-attachments"), { recursive: true, force: true });
            total -= candidate.bytes;
          } finally {
            await writer();
          }
        } finally {
          await unlock();
        }
      }
    } finally {
      await release();
    }
  }
}
