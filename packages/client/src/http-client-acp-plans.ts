import {
  AcpPlanPageSchema,
  AcpPlanViewSchema,
  AcpPlanResourceSchema,
  DeleteAcpPlanResponseSchema,
  type SaveAcpPlan,
  type StageAcpPlanResource,
  type ListAcpPlans,
} from "@codexly/protocol/acp-plan-api";
import type { AgentMessageAttachment } from "@codexly/protocol";
import { AcpHttpClient } from "./http-client-acp.js";
import type { ReadOptions, MutationOptions } from "./http-client-transport.js";
const path = (id: string) => `/v1/acp/plans/${encodeURIComponent(id)}`;
/** 新计划使用独立路径，沿用配对认证、严格解码及取消 / 幂等传输。 */
export class AcpPlanHttpClient extends AcpHttpClient {
  listAcpPlans(query: ListAcpPlans = {}, options: ReadOptions = {}) {
    const params = new URLSearchParams();
    if (query.after !== undefined) params.set("after", query.after);
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    const suffix = params.toString();
    return this.read(`/v1/acp/plans${suffix ? `?${suffix}` : ""}`, AcpPlanPageSchema, options);
  }
  readAcpPlan(id: string, options: ReadOptions = {}) {
    return this.read(path(id), AcpPlanViewSchema, options);
  }
  saveAcpPlan(id: string, input: SaveAcpPlan, options: MutationOptions = {}) {
    return this.mutation(path(id), input, AcpPlanViewSchema, options, "PUT", 150_000);
  }
  deleteAcpPlan(id: string, expectedRevision: number, options: MutationOptions = {}) {
    return this.mutation(
      path(id),
      { expectedRevision },
      DeleteAcpPlanResponseSchema,
      options,
      "DELETE",
    );
  }
  stageAcpPlanResource(id: string, input: StageAcpPlanResource, options: MutationOptions = {}) {
    return this.mutation(`${path(id)}/resources`, input, AcpPlanResourceSchema, options, "POST");
  }
  stageAcpPlanAttachment(
    id: string,
    projectId: string,
    attachment: AgentMessageAttachment,
    options: MutationOptions = {},
  ) {
    // Web 只引用已有上传身份，原始文件路径和元数据不成为服务端读取权限。
    return this.stageAcpPlanResource(id, { projectId, uploadId: attachment.id }, options);
  }
}
