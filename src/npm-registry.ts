import { CODEXLY_USER_AGENT } from "@codexly/protocol";

const MIRROR_REGISTRY = "https://registry.npmmirror.com";
const OFFICIAL_REGISTRY = "https://registry.npmjs.org";
const PROBE_TIMEOUT_MS = 3_000;

export type RegistryOrder = readonly [string, string];

export type RunNpmOptions = Readonly<{ elevated?: boolean; signal?: AbortSignal }>;
type RunNpm = (args: readonly string[], options?: RunNpmOptions) => Promise<string>;

export async function selectRegistryOrder(signal?: AbortSignal): Promise<RegistryOrder> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const probeSignal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(PROBE_TIMEOUT_MS),
    ...(signal === undefined ? [] : [signal]),
  ]);
  const registries: RegistryOrder = [OFFICIAL_REGISTRY, MIRROR_REGISTRY];
  try {
    // 并行 HEAD 探测包含 DNS、连接和 TLS 耗时，不下载包体；最先成功的源优先。
    // 不按所在地预设镜像优先，两个源都无法探测时仍按官方源顺序尝试真实请求。
    const fastest = await Promise.any(
      registries.map(async (registry) => {
        const response = await fetch(`${registry}/@openai/codex`, {
          method: "HEAD",
          headers: { "user-agent": CODEXLY_USER_AGENT },
          signal: probeSignal,
        });
        if (!response.ok) throw new Error(`Registry probe returned ${String(response.status)}`);
        return registry;
      }),
    );
    signal?.throwIfAborted();
    return fastest === OFFICIAL_REGISTRY ? registries : [MIRROR_REGISTRY, OFFICIAL_REGISTRY];
  } catch {
    signal?.throwIfAborted();
    return registries;
  } finally {
    // 得到结果或用户取消后立即终止剩余探测，避免后台连接继续占用资源。
    controller.abort();
  }
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
