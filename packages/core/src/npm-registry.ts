import { fetchDirect } from "./direct-fetch.js";
import { CODEXLY_USER_AGENT } from "@codexly/protocol";

const MIRROR_REGISTRY = "https://registry.npmmirror.com";
const OFFICIAL_REGISTRY = "https://registry.npmjs.org";
const PROBE_TIMEOUT_MS = 3_000;

export const NPM_REGISTRIES = [OFFICIAL_REGISTRY, MIRROR_REGISTRY] as const;
export type RegistryOrder = readonly [string, string];

export async function selectRegistryOrder(
  signal?: AbortSignal,
  metadataPath = "/@bryanhu%2fcodexly",
): Promise<RegistryOrder> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const probeSignal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(PROBE_TIMEOUT_MS),
    ...(signal === undefined ? [] : [signal]),
  ]);
  try {
    // 并行探测元数据的响应时间，涵盖 DNS、连接和 TLS 耗时，收到成功响应即可选源。
    const fastest = await Promise.any(
      NPM_REGISTRIES.map(async (registry) => {
        const response = await fetchDirect(`${registry}${metadataPath}`, {
          method: "HEAD",
          headers: { "user-agent": CODEXLY_USER_AGENT },
          signal: probeSignal,
        });
        if (!response.ok) throw new Error(`Registry probe returned ${String(response.status)}`);
        return registry;
      }),
    );
    signal?.throwIfAborted();
    return fastest === OFFICIAL_REGISTRY ? NPM_REGISTRIES : [MIRROR_REGISTRY, OFFICIAL_REGISTRY];
  } catch {
    signal?.throwIfAborted();
    // 源可能拒绝 HEAD 请求，继续按官方优先的顺序尝试实际下载。
    return NPM_REGISTRIES;
  } finally {
    // 选定源后释放剩余探测请求，避免与包体下载争用网络。
    controller.abort();
  }
}
