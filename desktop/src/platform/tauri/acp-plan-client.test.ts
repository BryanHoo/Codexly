import {expect,it,vi} from "vitest";
import {TauriCatalogClient} from "./catalog-client.js";
import type {InvokeImplementation} from "./native-client.js";
it("新计划从白名单 IPC 分页，不启动旧引擎",async()=>{
 const invoke=vi.fn(()=>Promise.resolve({data:[],nextCursor:null}));const ensureRuntime=vi.fn();
 const client=new TauriCatalogClient({invoke:invoke as InvokeImplementation,ensureRuntime});
 expect(await client.listAcpPlans({after:"id",limit:20})).toEqual({data:[],nextCursor:null});
 expect(invoke).toHaveBeenCalledWith("acp_plan_request",{request:{type:"list",after:"id",limit:20}});expect(ensureRuntime).not.toHaveBeenCalled();
});

it("保存和附件暂存保留原始 false、双修订及授权元数据，坏响应被拒绝",async()=>{
 const definition=(await import("../../../../tests/fixtures/acp-scheduled-plan-definition.json")).default;
 const view={source:"desktop",scheduleId:"plan",definition,revision:1,state:{revision:1,definitionRevision:1,nextRunAt:null},resources:[],canEdit:true};
 const resource={token:"token",attachment:{id:"ref",kind:"file",mediaType:"x",name:"a",size:1},digest:"a".repeat(64),written:1,boundRevision:null};
 const invoke=vi.fn().mockResolvedValueOnce(view).mockResolvedValueOnce(resource).mockResolvedValueOnce({data:[],nextCursor:1});
 const client=new TauriCatalogClient({invoke:invoke as InvokeImplementation});
 const input={definition,resources:[],expectedRevision:0,expectedStateRevision:0};
 expect(await client.saveAcpPlan("plan",input as never)).toEqual(view);
 const attachment={id:"/authorized/upload",kind:"file" as const,mediaType:"x",name:"a",size:1};
 expect(await client.stageAcpPlanAttachment("plan","p",attachment)).toEqual(resource);
 expect(invoke).toHaveBeenNthCalledWith(1,"acp_plan_request",{request:{type:"save",planId:"plan",input}});
 expect(invoke).toHaveBeenNthCalledWith(2,"acp_plan_request",{request:{type:"stage",planId:"plan",projectId:"p",attachment}});
 await expect(client.listAcpPlans()).rejects.toThrow("Invalid ACP plan response");
});
it("取消新计划请求只发送该请求的取消身份",async()=>{
 const invoke=vi.fn((command:string)=>command==="acp_plan_request"?new Promise(()=>undefined):Promise.resolve({}));
 const client=new TauriCatalogClient({invoke:invoke as InvokeImplementation});const controller=new AbortController();
 const request=client.listAcpPlans({}, {signal:controller.signal});
 await vi.waitFor(()=>expect(invoke).toHaveBeenCalledWith("acp_plan_request",expect.objectContaining({requestId:expect.any(String)})));
 controller.abort();await expect(request).rejects.toMatchObject({name:"AbortError"});
 expect(invoke).toHaveBeenCalledWith("cancel_native_request",expect.objectContaining({requestId:expect.any(String)}));
});
