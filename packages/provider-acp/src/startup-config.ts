import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  AcpConfigPreviewSchema,
  isAcpModelScopedOption,
  type AcpConfigOption,
  type AcpConfigPreview,
  type AgentEngine,
} from "@codexly/protocol";
import { waitForAcpPreview } from "./config-preview.js";
import type { AcpStorageLeases } from "./storage-lease.js";

const Snapshot = Type.Object(
  {
    version: Type.Literal(1),
    binding: Type.String(),
    preview: AcpConfigPreviewSchema,
  },
  { additionalProperties: false },
);
type Snapshot = Static<typeof Snapshot>;
const maxBytes = 2 * 1024 * 1024;
type ModelOptions = NonNullable<AcpConfigPreview["modelOptions"]>[number];

function modelOptions(configOptions: AcpConfigOption[]): ModelOptions | undefined {
  const model = configOptions.find(
    (option) => option.type === "select" && (option.category === "model" || option.id === "model"),
  );
  if (model?.type !== "select" || !model.currentValue) return undefined;
  return {
    modelId: model.currentValue,
    // 权限模式属于真实会话。这里只学习随模型变化的能力描述。
    configOptions: configOptions.filter(isAcpModelScopedOption),
  };
}

/** 两端宿主共用有界快照。前台只取消同引擎的独立缓存探测。 */
export class AcpStartupConfig {
  readonly #foreground = new Map<AgentEngine, number>();
  readonly #probes = new Map<
    AgentEngine,
    { cancel: AbortController; result: Promise<AcpConfigPreview | null> }
  >();
  readonly #writes = new Map<AgentEngine, Promise<AcpConfigPreview | null>>();
  #closed = false;

  constructor(
    readonly directory: string,
    readonly binding: (engine: AgentEngine) => Promise<string>,
    readonly leases?: AcpStorageLeases,
  ) {}

  foreground(engine: AgentEngine): () => void {
    this.#foreground.set(engine, (this.#foreground.get(engine) ?? 0) + 1);
    this.#probes.get(engine)?.cancel.abort();
    return () => {
      const remaining = (this.#foreground.get(engine) ?? 1) - 1;
      if (remaining) this.#foreground.set(engine, remaining);
      else this.#foreground.delete(engine);
    };
  }

  async #read(engine: AgentEngine, binding: string): Promise<AcpConfigPreview | null> {
    const path = join(this.directory, `${engine}.json`);
    try {
      if ((await stat(path)).size > maxBytes) return null;
      const input: unknown = JSON.parse(await readFile(path, "utf8"));
      if (Value.Check(Snapshot, input) && input.binding === binding) return input.preview;
    } catch {
      // 旧版本、损坏或缺失的文件均按未命中处理，可正常重建。
    }
    return null;
  }

  async read(engine: AgentEngine): Promise<AcpConfigPreview | null> {
    const binding = await this.binding(engine).catch(() => undefined);
    return binding === undefined ? null : this.#read(engine, binding);
  }

  refresh(
    engine: AgentEngine,
    load: (signal: AbortSignal) => Promise<AcpConfigPreview>,
    signal?: AbortSignal,
  ): Promise<AcpConfigPreview | null> {
    if (this.#closed || this.#foreground.has(engine)) return this.read(engine);
    const previous = this.#probes.get(engine);
    if (previous && !previous.cancel.signal.aborted)
      return waitForAcpPreview(previous.result, signal);
    const cancel = new AbortController();
    const active = AbortSignal.any([
      cancel.signal,
      AbortSignal.timeout(8_000),
      ...(signal ? [signal] : []),
    ]);
    const work = async () => {
      const binding = await this.binding(engine);
      active.throwIfAborted();
      const preview = await load(active);
      active.throwIfAborted();
      const persisted = await this.#write(
        engine,
        binding,
        (current) => ({
          ...preview,
          modelOptions: this.#mergeOptions(current, modelOptions(preview.configOptions), false),
        }),
        active,
      );
      return persisted ?? preview;
    };
    // 某些传输的取消回执会迟到。停止等待并校验代次，迟到的探测结果不得写回。
    const result = waitForAcpPreview(work(), active)
      .catch((error: unknown) => {
        if (active.aborted) return this.read(engine);
        throw error;
      })
      .finally(() => {
        if (this.#probes.get(engine)?.cancel === cancel) this.#probes.delete(engine);
      });
    this.#probes.set(engine, { cancel, result });
    return result;
  }

  #mergeOptions(
    current: AcpConfigPreview | null,
    observed: ModelOptions | undefined,
    live: boolean,
  ) {
    const previous = current?.modelOptions ?? [];
    if (!observed) return previous;
    const options = new Map(previous.map((model) => [model.modelId, model]));
    if (!live && options.has(observed.modelId)) return previous;
    options.delete(observed.modelId);
    options.set(observed.modelId, observed);
    return [...options.values()].slice(-128);
  }

  async observe(engine: AgentEngine, binding: string, options: AcpConfigOption[]): Promise<void> {
    const observed = modelOptions(options);
    if (!observed || this.#closed) return;
    await this.#write(engine, binding, (current) => {
      return {
        // 真实任务只贡献模型能力。任务采用的默认值或权限不进入应用的草稿默认值。
        ...(current ?? { configOptions: [], values: {} }),
        modelOptions: this.#mergeOptions(current, observed, true),
      };
    });
  }

  /** 首发抢占探测时，真实新会话已应用的默认值可补齐首次启动仍缺失的快照。 */
  async rememberDefaults(
    engine: AgentEngine,
    binding: string,
    configOptions: AcpConfigOption[],
  ): Promise<void> {
    if (this.#closed || configOptions.length === 0) return;
    await this.#write(engine, binding, (current) =>
      current?.configOptions.length
        ? current
        : {
            ...current,
            configOptions,
            values: Object.fromEntries(
              configOptions.map(({ id, currentValue }) => [id, currentValue]),
            ),
            modelOptions: this.#mergeOptions(current, modelOptions(configOptions), false),
          },
    );
  }

  #write(
    engine: AgentEngine,
    binding: string,
    update: (previous: AcpConfigPreview | null) => AcpConfigPreview | null,
    signal?: AbortSignal,
  ) {
    const previous = this.#writes.get(engine) ?? Promise.resolve(null);
    const pending = previous
      .then(async () => {
        if ((await this.binding(engine)) !== binding || signal?.aborted) return null;
        const release = await this.leases?.acquire(`acp-config-cache:${engine}`);
        try {
          const current = await this.#read(engine, binding);
          const result = update(current);
          if (!result || JSON.stringify(current) === JSON.stringify(result)) return result;
          const snapshot: Snapshot = { version: 1, binding, preview: result };
          const body = JSON.stringify(snapshot);
          if (Buffer.byteLength(body) > maxBytes || !Value.Check(Snapshot, snapshot)) return result;
          await mkdir(this.directory, { recursive: true, mode: 0o700 });
          const path = join(this.directory, `${engine}.json`);
          const temp = `${path}.${randomUUID()}.tmp`;
          try {
            await writeFile(temp, body, { flag: "wx", mode: 0o600 });
            signal?.throwIfAborted();
            if (this.#closed) return null;
            await rename(temp, path);
          } finally {
            await rm(temp, { force: true });
          }
          return result;
        } finally {
          await release?.();
        }
      })
      .catch(() => null)
      .finally(() => {
        if (this.#writes.get(engine) === pending) this.#writes.delete(engine);
      });
    this.#writes.set(engine, pending);
    return pending;
  }

  close(): void {
    this.#closed = true;
    for (const { cancel } of this.#probes.values()) cancel.abort();
  }
}
