const MIRROR_REGISTRY = "https://registry.npmmirror.com";
const OFFICIAL_REGISTRY = "https://registry.npmjs.org";

export type RunNpmOptions = Readonly<{ signal?: AbortSignal }>;
type RunNpm = (args: readonly string[], options?: RunNpmOptions) => Promise<string>;

export async function withRegistryFallback<T>(
  request: (registry: string) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  try {
    return await request(MIRROR_REGISTRY);
  } catch {
    // 用户取消必须立即退出，只有未取消的失败才允许切换官方源。
    signal?.throwIfAborted();
    return request(OFFICIAL_REGISTRY);
  }
}

export function runNpmWithRegistryFallback(
  runNpm: RunNpm,
  args: readonly string[],
  options: RunNpmOptions = {},
): Promise<string> {
  return withRegistryFallback(
    (registry) =>
      runNpm(
        [
          ...args.slice(0, 1),
          `--registry=${registry}`,
          `--@openai:registry=${registry}`,
          `--@bryanhu:registry=${registry}`,
          // 沿用用户的持久 npm cache，缺失内容仍联网获取，不创建随更新删除的缓存。
          "--prefer-offline",
          "--prefer-online=false",
          // 限制单源等待，避免 npm 默认重试退避延迟官方源兜底。
          "--fetch-retries=0",
          "--fetch-timeout=30000",
          ...args.slice(1),
        ],
        options,
      ),
    options.signal,
  );
}
