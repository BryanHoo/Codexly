import type { ProjectRuntimeContext } from "./routes/context.js";

export const DEFAULT_PROJECT_RUNTIME_CLEANUP_INTERVAL_MS = 60_000;
export const DEFAULT_PROJECT_RUNTIME_IDLE_TTL_MS = 30 * 60 * 1_000;

type ProjectRuntimeIdleReaperOptions = Readonly<{
  cleanupIntervalMs: number;
  clock?: () => number;
  contexts: ReadonlyMap<string, ProjectRuntimeContext>;
  idleTtlMs: number;
  onReleaseError?: (error: unknown, projectId: string) => void;
  release: (projectId: string) => Promise<void>;
}>;

export class ProjectRuntimeIdleReaper {
  readonly #activity = new Map<string, number>();
  readonly #cleanupTimer: ReturnType<typeof setInterval>;
  readonly #clock: () => number;
  readonly #contexts: ReadonlyMap<string, ProjectRuntimeContext>;
  readonly #idleTtlMs: number;
  readonly #onReleaseError: (error: unknown, projectId: string) => void;
  readonly #release: (projectId: string) => Promise<void>;
  #closed = false;
  #scanPromise: Promise<void> | undefined;

  public constructor(options: ProjectRuntimeIdleReaperOptions) {
    for (const [name, value] of [
      ["cleanupIntervalMs", options.cleanupIntervalMs],
      ["idleTtlMs", options.idleTtlMs],
    ] as const) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer`);
      }
    }
    this.#clock = options.clock ?? Date.now;
    this.#contexts = options.contexts;
    this.#idleTtlMs = options.idleTtlMs;
    this.#onReleaseError = options.onReleaseError ?? (() => undefined);
    this.#release = options.release;
    this.#cleanupTimer = setInterval(() => {
      void this.#prune();
    }, options.cleanupIntervalMs);
    this.#cleanupTimer.unref();
  }

  public touch(projectId: string): void {
    if (!this.#closed) {
      this.#activity.set(projectId, this.#clock());
    }
  }

  public forget(projectId: string): void {
    this.#activity.delete(projectId);
  }

  public async close(): Promise<void> {
    if (!this.#closed) {
      this.#closed = true;
      clearInterval(this.#cleanupTimer);
    }
    await this.#scanPromise;
    this.#activity.clear();
  }

  #prune(): Promise<void> {
    if (this.#closed) {
      return Promise.resolve();
    }
    this.#scanPromise ??= this.#scan().finally(() => {
      this.#scanPromise = undefined;
    });
    return this.#scanPromise;
  }

  async #scan(): Promise<void> {
    const now = this.#clock();
    for (const [projectId, context] of this.#contexts) {
      const lastActiveAt = this.#activity.get(projectId);
      if (lastActiveAt === undefined) {
        this.#activity.set(projectId, now);
        continue;
      }
      if (
        context.transportMetrics.activeClients > 0 ||
        lastActiveAt + this.#idleTtlMs > now ||
        this.#contexts.get(projectId) !== context
      ) {
        continue;
      }
      try {
        // releaseProjectContext 会先同步移出 Map，再异步释放 Provider 与上传附件。
        await this.#release(projectId);
        if (!this.#contexts.has(projectId)) {
          this.#activity.delete(projectId);
        }
      } catch (error) {
        this.#onReleaseError(error, projectId);
      }
    }
  }
}
