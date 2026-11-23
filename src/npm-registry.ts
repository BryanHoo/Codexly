import { NPM_REGISTRIES, selectRegistryOrder, type RegistryOrder } from "@codexly/core";

export { selectRegistryOrder, type RegistryOrder };

export type RunNpmOptions = Readonly<{ elevated?: boolean; signal?: AbortSignal }>;
type RunNpm = (args: readonly string[], options?: RunNpmOptions) => Promise<string>;

export function withOfficialRegistryFallback<T>(request: (registry: string) => Promise<T>) {
  // 镜像的版本标签可能滞后，元数据优先读官方源；不可达时仍由镜像兜底。
  // 包体与依赖下载继续使用速度探测，避免将元数据一致性与下载策略混为一谈。
  return withRegistryFallback(request, undefined, NPM_REGISTRIES);
}

export async function withRegistryFallback<T>(
  request: (registry: string) => Promise<T>,
  signal?: AbortSignal,
  registryOrder?: RegistryOrder,
): Promise<T> {
  const registries = registryOrder ?? (await selectRegistryOrder(signal));
  signal?.throwIfAborted();
  try {
    return await request(registries[0]);
  } catch {
    // 用户取消必须立即退出，只有未取消的失败才允许切换另一个源。
    signal?.throwIfAborted();
    return request(registries[1]);
  }
}

export function runNpmWithRegistryFallback(
  runNpm: RunNpm,
  args: readonly string[],
  options: RunNpmOptions = {},
  registryOrder?: RegistryOrder,
): Promise<string> {
  return withRegistryFallback(
    (registry) =>
      runNpm(
        [
          ...args.slice(0, 1),
          `--registry=${registry}`,
          `--@openai:registry=${registry}`,
          `--@bryanhu:registry=${registry}`,
          // 沿用用户的持久 npm cache，并保留 npm 默认的过期元数据重新校验行为。
          // 限制单源等待，避免 npm 默认重试退避延迟备用源兜底。
          "--fetch-retries=0",
          "--fetch-timeout=30000",
          ...args.slice(1),
        ],
        options,
      ),
    options.signal,
    registryOrder,
  );
}
