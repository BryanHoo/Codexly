import { createHash } from "node:crypto";
import type { FastifyReply } from "fastify";

export function sendPrivateAsset(
  reply: FastifyReply,
  asset: Readonly<{ content: Uint8Array; mediaType: string }>,
  maxAge: number,
  ifNoneMatch: string | undefined,
) {
  const { content, mediaType } = asset;
  // 内容指纹随资源变化，过期后可复验并返回无正文的 304，避免再次传输完整图片或附件。
  const etag = `"${createHash("sha256").update(content).digest("hex")}"`;
  reply
    .header("cache-control", `private, max-age=${String(maxAge)}`)
    .header("etag", etag)
    .header("x-content-type-options", "nosniff")
    .type(mediaType);
  const matches = ifNoneMatch?.split(",").some((value) => {
    const candidate = value.trim().replace(/^W\//u, "");
    return candidate === etag || candidate === "*";
  });
  if (matches) return reply.code(304).send();
  return reply.send(Buffer.from(content.buffer, content.byteOffset, content.byteLength));
}
