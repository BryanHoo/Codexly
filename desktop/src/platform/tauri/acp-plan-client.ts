import {Value} from "@sinclair/typebox/value";
import type {Static,TSchema} from "@sinclair/typebox";
import type {AgentMessageAttachment} from "@codexly/protocol";
import {AcpPlanPageSchema,AcpPlanViewSchema,AcpPlanResourceSchema,DeleteAcpPlanResponseSchema,type SaveAcpPlan,type ListAcpPlans} from "@codexly/protocol/acp-plan-api";
import {TauriAcpClient} from "./acp-client.js";
import type {ReadOptions,MutationOptions} from "@/platform/native-client-types.js";
/** 计划管理走已注册白名单，不初始化旧厂商运行时；响应在跨 IPC 边界严格解码。 */
export class TauriAcpPlanClient extends TauriAcpClient {
 private async plan<T extends TSchema>(request:Record<string,unknown>,schema:T,options:ReadOptions):Promise<Static<T>> {
  const data:unknown=await this.callCancellable("acp_plan_request",{request},options.signal);
  if(!Value.Check(schema,data))throw new TypeError("Invalid ACP plan response");
  return data;
 }
 listAcpPlans(query:ListAcpPlans={},options:ReadOptions={}) {return this.plan({type:"list",...query},AcpPlanPageSchema,options);}
 readAcpPlan(planId:string,options:ReadOptions={}) {return this.plan({type:"read",planId},AcpPlanViewSchema,options);}
 saveAcpPlan(planId:string,input:SaveAcpPlan,options:MutationOptions={}) {return this.plan({type:"save",planId,input},AcpPlanViewSchema,options);}
 deleteAcpPlan(planId:string,expectedRevision:number,options:MutationOptions={}) {return this.plan({type:"delete",planId,expectedRevision},DeleteAcpPlanResponseSchema,options);}
 stageAcpPlanAttachment(planId:string,projectId:string,attachment:AgentMessageAttachment,options:MutationOptions={}) {return this.plan({type:"stage",planId,projectId,attachment},AcpPlanResourceSchema,options);}
}
