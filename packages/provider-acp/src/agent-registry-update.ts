import type { ReadableStream } from "node:stream/web";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { RegistryAgent } from "./agent-installer.js";

const REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const MAX_REGISTRY_BYTES = 1024 * 1024;
const STABLE_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const versions = new Intl.Collator("en", { numeric: true });
const spec = {
  args: Type.Optional(Type.Array(Type.String(), { maxItems: 128 })),
  env: Type.Optional(
    Type.Record(Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$" }), Type.String()),
  ),
};
const Distribution = Type.Object({
  npx: Type.Optional(Type.Object({ ...spec, package: Type.String() })),
  uvx: Type.Optional(Type.Object({ ...spec, package: Type.String() })),
  binary: Type.Optional(
    Type.Record(
      Type.String(),
      Type.Object({
        ...spec,
        archive: Type.String({ pattern: "^https://" }),
        cmd: Type.String({ minLength: 1 }),
        sha256: Type.Optional(Type.String({ pattern: "^[0-9a-fA-F]{64}$" })),
      }),
    ),
  ),
});
const CatalogEntry = Type.Object({
  id: Type.String(),
  version: Type.String({ pattern: STABLE_VERSION.source }),
  distribution: Distribution,
});
const RegistryIndex = Type.Object({
  version: Type.Literal("1.0.0"),
  agents: Type.Array(Type.Unknown()),
});

export function isStableAgentVersion(value: unknown): value is string {
  return typeof value === "string" && STABLE_VERSION.test(value);
}

export async function findRegistryUpdate(
  bundled: RegistryAgent,
  installedVersion: string | undefined,
  signal: AbortSignal,
): Promise<RegistryAgent | undefined> {
  const response = await fetch(REGISTRY_URL, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    redirect: "error",
  });
  if (!response.ok || !response.body) throw new Error("无法检查 ACP Agent 更新");
  // 仅在手动更新时下载目录元数据，并限制解压后的响应大小。
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REGISTRY_BYTES) throw new Error("ACP Agent 目录超出大小限制");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const data: unknown = JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
  if (!Value.Check(RegistryIndex, data)) throw new Error("ACP Agent 目录格式无效");
  const candidate = data.agents.find(
    (item) => item && typeof item === "object" && "id" in item && item.id === bundled.id,
  );
  if (!Value.Check(CatalogEntry, candidate)) throw new Error("官方目录中缺少可用的 Agent 版本");
  const { version, distribution } = candidate;
  // 日期版本可能带前导零，按数字比较各段，避免误将旧版本写回。
  if (installedVersion && versions.compare(version, installedVersion) <= 0) return;
  const { npx, uvx, binary } = distribution;
  if (
    (npx && !npx.package.endsWith(`@${version}`)) ||
    (uvx && !uvx.package.endsWith(`@${version}`) && !uvx.package.endsWith(`==${version}`)) ||
    (!npx && !uvx && !Object.keys(binary ?? {}).length)
  )
    throw new Error("官方目录中的 Agent 安装包版本无效");
  return { ...bundled, version, distribution };
}
