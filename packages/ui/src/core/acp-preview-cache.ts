import { createContext, useCallback, useContext, useSyncExternalStore } from "react";
import { hashKey, QueryClientContext, type QueryClient } from "@tanstack/react-query";
import {
  isAcpModelScopedOption,
  type AcpConfigOption,
  type AcpConfigPreview,
  type AcpConfigValues,
  type AgentEngine,
} from "@codexly/protocol";

type Load = (engine: AgentEngine, signal: AbortSignal) => Promise<AcpConfigPreview | null>;
type Catalog = Readonly<Partial<Record<AgentEngine, AcpConfigPreview>>>;
const queryKey = ["acp-preview"] as const;
const queryHash = hashKey(queryKey);
const empty: Catalog = {};
export const AcpStartupCacheContext = createContext(false);
const queues = new WeakMap<
  QueryClient,
  {
    attempts: Map<AgentEngine, object>;
    tail: Promise<void> | undefined;
    load: Load;
  }
>();

export function readCachedAcpPreview(cache: QueryClient | undefined, engine: AgentEngine) {
  return cache?.getQueryData<Catalog>(queryKey)?.[engine];
}

export function useAcpPreviewCatalog(): Catalog {
  const cache = useContext(QueryClientContext);
  const subscribe = useCallback(
    (notify: () => void) =>
      cache?.getQueryCache().subscribe(({ query }) => {
        if (query.queryHash === queryHash) notify();
      }) ?? (() => undefined),
    [cache],
  );
  const read = useCallback(() => cache?.getQueryData<Catalog>(queryKey) ?? empty, [cache]);
  return useSyncExternalStore(subscribe, read, read);
}

export function overlayAcpConfig(
  options: readonly AcpConfigOption[],
  values: AcpConfigValues,
): AcpConfigOption[] {
  return options.map((option) => {
    const value = values[option.id];
    if (option.type === "select" && typeof value === "string")
      return { ...option, currentValue: value };
    if (option.type === "boolean" && typeof value === "boolean")
      return { ...option, currentValue: value };
    return option;
  });
}

export function modelScopedAcpOptions(
  baseline: readonly AcpConfigOption[],
  cached: AcpConfigPreview | undefined,
  values: AcpConfigValues,
): readonly AcpConfigOption[] {
  const model = baseline.find(
    (option) => option.type === "select" && (option.category === "model" || option.id === "model"),
  );
  const picked = model && values[model.id];
  if (!model || typeof picked !== "string" || picked === model.currentValue) return baseline;
  const next = cached?.modelOptions?.find((entry) => entry.modelId === picked);
  return [
    ...baseline.filter((option) => !isAcpModelScopedOption(option)),
    ...(next?.configOptions ?? []),
  ];
}

/** 模型变化时清理上一模型的显式设置，保留独立的权限和模式。 */
export function resetAcpModelOverrides(
  options: readonly AcpConfigOption[],
  cached: AcpConfigPreview | undefined,
  values: AcpConfigValues,
  configId: string,
  value: string | boolean,
): AcpConfigValues {
  const model = options.find(
    (option) => option.type === "select" && (option.category === "model" || option.id === "model"),
  );
  if (model?.id !== configId || (values[configId] ?? model.currentValue) === value) return values;
  const scoped = new Set([
    ...options.filter(isAcpModelScopedOption).map(({ id }) => id),
    ...(cached?.modelOptions ?? []).flatMap(({ configOptions }) =>
      configOptions.map(({ id }) => id),
    ),
  ]);
  return Object.fromEntries(Object.entries(values).filter(([id]) => !scoped.has(id)));
}

/** 实时会话补齐当前模型的选项，同时保留启动快照中的默认模式和选项值。 */
export function rememberAcpModelOptions(
  cache: QueryClient,
  engine: AgentEngine,
  options: AcpConfigOption[],
): void {
  const current = readCachedAcpPreview(cache, engine);
  const model = options.find(
    (option) => option.type === "select" && (option.category === "model" || option.id === "model"),
  );
  if (model?.type !== "select" || !model.currentValue) return;
  const previous = current?.modelOptions ?? [];
  const configOptions = options.filter(isAcpModelScopedOption);
  const old = previous.find((entry) => entry.modelId === model.currentValue);
  if (old && JSON.stringify(old.configOptions) === JSON.stringify(configOptions)) return;
  const modelOptions = [
    ...previous.filter((entry) => entry.modelId !== model.currentValue),
    {
      modelId: model.currentValue,
      configOptions,
    },
  ].slice(-128);
  cache.setQueryData<Catalog>(queryKey, (catalog) => ({
    ...catalog,
    [engine]: {
      ...current,
      // 首次发送抢占探测时也能立即展示该 Agent 的模型目录。任务选中的模型不充当默认值。
      configOptions: current?.configOptions.length
        ? current.configOptions
        : [{ ...model, currentValue: "" }],
      values: current?.values ?? {},
      modelOptions,
    },
  }));
}

export function warmAcpPreviews(
  cache: QueryClient,
  engines: readonly AgentEngine[],
  load: Load,
  timeoutMs = 8_000,
  readCached?: Load,
): Promise<void> {
  let queue = queues.get(cache);
  if (!queue) {
    queue = { attempts: new Map(), tail: undefined, load };
    queues.set(cache, queue);
    cache.setQueryDefaults(queryKey, { gcTime: Infinity });
  }
  const current = queue;
  current.load = load;
  for (const engine of engines) {
    if (current.attempts.has(engine)) continue;
    const attempt = {};
    current.attempts.set(engine, attempt);
    // 先并行读取各引擎的宿主快照。首个引擎的刷新不会延迟后续引擎的已存菜单。
    let refreshed = false;
    let published = readCachedAcpPreview(cache, engine)?.modelOptions;
    const learned = new Map<string, NonNullable<AcpConfigPreview["modelOptions"]>[number]>();
    const publish = (preview: AcpConfigPreview) => {
      const catalog = cache.setQueryData<Catalog>(queryKey, (previous) => {
        for (const entry of previous?.[engine]?.modelOptions ?? []) {
          if (!published?.includes(entry)) learned.set(entry.modelId, entry);
        }
        if (!learned.size) return { ...previous, [engine]: preview };
        // 探测等待期间由真实会话公布的选项优先，避免旧快照覆盖刚切换的模型。
        const choices = new Map(preview.modelOptions?.map((entry) => [entry.modelId, entry]));
        for (const [id, entry] of learned) {
          choices.delete(id);
          choices.set(id, entry);
        }
        return {
          ...previous,
          [engine]: { ...preview, modelOptions: [...choices.values()].slice(-128) },
        };
      });
      published = catalog?.[engine]?.modelOptions;
    };
    if (readCached)
      void readCached(engine, AbortSignal.timeout(timeoutMs))
        .then((preview) => {
          if (preview && !refreshed && current.attempts.get(engine) === attempt) publish(preview);
        })
        .catch(() => undefined);
    const job = async () => {
      if (current.attempts.get(engine) !== attempt) return;
      const signal = AbortSignal.timeout(timeoutMs);
      // 即使传输没有响应取消，也要让队列按时前进。超时或设置更新后的结果不能写回。
      const timeout = new Promise<undefined>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            resolve(undefined);
          },
          { once: true },
        );
      });
      try {
        const result = await Promise.race([current.load(engine, signal), timeout]);
        if (result && !signal.aborted && current.attempts.get(engine) === attempt) {
          refreshed = true;
          publish(result);
        }
      } catch {
        // 登录失效等错误由实际发送报告，启动读取失败只影响该 Agent 的菜单。
      }
    };
    current.tail = current.tail ? current.tail.then(job) : job();
  }
  return current.tail ?? Promise.resolve();
}

/** 保存设置或重新登录后只刷新受影响的 Agent，草稿切换本身不会访问宿主。 */
export function invalidateAcpPreviews(cache: QueryClient, engine: AgentEngine): Promise<void> {
  const queue = queues.get(cache);
  if (queue?.attempts.delete(engine)) void warmAcpPreviews(cache, [engine], queue.load);
  return Promise.resolve();
}

/** 全局默认值的保存回执包含完整选项，直接更新菜单，避免保存后再次启动临时会话。 */
export function updateAcpPreviewOptions(
  cache: QueryClient,
  engine: AgentEngine,
  configOptions: AcpConfigOption[],
) {
  const queue = queues.get(cache);
  if (!queue) return;
  queue.attempts.set(engine, {});
  cache.setQueryData<Catalog>(queryKey, (previous) => ({
    ...previous,
    [engine]: {
      ...previous?.[engine],
      configOptions,
      values: Object.fromEntries(configOptions.map(({ id, currentValue }) => [id, currentValue])),
    },
  }));
}
