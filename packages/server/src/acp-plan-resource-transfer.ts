import type {
  AcpPlanResource,
  AcpPlanResourceScope,
  AcpScheduledPlan,
  LocalCatalogStore,
} from "@codexly/core";
import type { AgentPromptInput } from "@codexly/protocol";
import type { AttachmentStore } from "./attachment-store.js";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

export class AcpPlanResourceManager {
  constructor(
    readonly catalog: LocalCatalogStore,
    readonly uploads: AttachmentStore,
  ) {}
  /** 按不可变修订恢复本轮副本；完整摘要通过后才返回可供提交的授权引用。 */
  async restore(
    plan: AcpScheduledPlan,
    signal?: AbortSignal,
    owner?: string,
  ): Promise<{ prompt: AgentPromptInput; restoredIds: string[] }> {
    if (plan.source !== "web") throw new TypeError("Invalid ACP resource source");
    signal?.throwIfAborted();
    const scope = {
      source: plan.source,
      scheduleId: plan.scheduleId,
      projectId: plan.definition.projectId,
    };
    const resources = await this.catalog.catalog("acp.resource.list", {
      ...scope,
      expectedRevision: plan.revision,
    });
    const byId = new Map(resources.map((resource) => [resource.attachment.id, resource]));
    const references = plan.definition.prompt.attachments;
    if (
      resources.length !== references.length ||
      byId.size !== resources.length ||
      new Set(references.map((ref) => ref.id)).size !== references.length ||
      references.some((ref) => !byId.has(ref.id))
    ) {
      throw new Error("ACP plan resources do not match the definition revision");
    }
    const restoredIds: string[] = [];
    const attachments: { id: string }[] = [];
    try {
      for (const reference of references) {
        signal?.throwIfAborted();
        const resource = byId.get(reference.id);
        if (!resource?.digest) throw new Error("ACP plan resource is not sealed");
        const input = {
          kind: resource.attachment.kind,
          mediaType: resource.attachment.mediaType,
          name: resource.attachment.name,
          content: Readable.from(this.#chunks(scope, resource, signal), {
            objectMode: false,
            highWaterMark: 262144,
          }),
        };
        const uploaded = await (owner
          ? this.uploads.addOwned(scope.projectId, input, owner)
          : this.uploads.add(scope.projectId, input));
        restoredIds.push(uploaded.attachment.id);
        signal?.throwIfAborted();
        if (
          uploaded.attachment.size !== resource.attachment.size ||
          uploaded.contentDigest !== resource.digest
        ) {
          throw new Error("ACP plan resource content digest mismatch");
        }
        attachments.push({ id: uploaded.attachment.id });
      }
      return { prompt: { ...plan.definition.prompt, attachments }, restoredIds };
    } catch (error) {
      try {
        await this.discard(restoredIds);
        if (owner) await this.releaseOwner(scope.projectId, owner);
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], "ACP resource restoration cleanup failed", {
          cause: cleanup,
        });
      }
      throw error;
    }
  }
  releaseOwner(projectId: string, owner: string): Promise<void> {
    return this.uploads.discardOwned(projectId, owner);
  }
  async *#chunks(scope: AcpPlanResourceScope, resource: AcpPlanResource, signal?: AbortSignal) {
    let offset = 0;
    while (offset < resource.attachment.size) {
      signal?.throwIfAborted();
      const bytes = await this.catalog.catalog("acp.resource.chunk", {
        ...scope,
        token: resource.token,
        offset,
      });
      if (!bytes?.length || bytes.length > resource.attachment.size - offset)
        throw new Error("Incomplete ACP plan resource");
      signal?.throwIfAborted();
      yield bytes;
      offset += bytes.length;
    }
  }
  async discard(ids: readonly string[]) {
    const errors: unknown[] = [];
    for (const id of ids) {
      try {
        await this.uploads.discard(id);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "ACP restored upload cleanup failed", { cause: errors[0] });
  }
  /** 只暂存项目授权器返回的上传；独立引用可跨重启使用，不保存原生路径。 */
  async stage(
    scope: AcpPlanResourceScope,
    uploadId: string,
    signal?: AbortSignal,
  ): Promise<AcpPlanResource> {
    if (scope.source !== "web") throw new TypeError("Invalid ACP resource source");
    signal?.throwIfAborted();
    const upload = await this.uploads.stream(scope.projectId, uploadId);
    const key = { ...scope, token: randomUUID() };
    try {
      signal?.throwIfAborted();
      await this.catalog.catalog("acp.resource.begin", {
        ...key,
        attachment: { ...upload.attachment, id: randomUUID() },
      });
      let offset = 0;
      // 每次等待持久化后再读取下一块，避免大文件或慢磁盘积累在途字节。
      for await (const chunk of upload.content) {
        const bytes = chunk as Buffer;
        for (let at = 0; at < bytes.length; at += 262144) {
          signal?.throwIfAborted();
          const content = bytes.subarray(at, at + 262144);
          offset = await this.catalog.catalog("acp.resource.append", { ...key, offset, content });
        }
      }
      signal?.throwIfAborted();
      return await this.catalog.catalog("acp.resource.seal", key);
    } catch (error) {
      try {
        await this.catalog.catalog("acp.resource.abort", key);
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], "ACP resource staging cleanup failed", {
          cause: cleanup,
        });
      }
      throw error;
    } finally {
      upload.content.destroy();
    }
  }
}
