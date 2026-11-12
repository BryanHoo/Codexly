import {StrictMode} from "react";
import {beforeEach,expect,it,vi} from "vitest";
import {page} from "vitest/browser";
import {render} from "vitest-browser-react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {ScheduledTasksContainer as Web} from "../../../apps/web/src/features/scheduled-tasks/scheduled-tasks-container.js";
import {ScheduledTasksContainer as Native} from "../../src/features/scheduled-tasks/scheduled-tasks-container.js";
import "../../src/shared/styles/globals.css";
import {changeAppLanguage as webLanguage} from "../../../apps/web/src/i18n/i18n.js";
import {changeAppLanguage as nativeLanguage} from "../../src/i18n/i18n.js";
function fixture(){
 const save=vi.fn(async(id:string,input:Record<string,unknown>)=>({source:"web",scheduleId:id,revision:Number(input.expectedRevision)+1,definition:input.definition,state:{revision:Number(input.expectedStateRevision)+1,definitionRevision:Number(input.expectedRevision)+1,nextRunAt:null},canEdit:true,resources:[]}));
 const client={listScheduledTasks:vi.fn(async()=>({data:[]})),subscribeScheduledTasks:vi.fn(()=>()=>{}),listAcpPlans:vi.fn(async()=>({data:[],nextCursor:null})),saveAcpPlan:save,uploadAttachment:vi.fn(),stageAcpPlanAttachment:vi.fn(),readAcpPlan:vi.fn(),deleteAcpPlan:vi.fn(),previewAcpConfig:vi.fn(async()=>({values:{flag:false},configOptions:[{id:"flag",name:"允许写入",type:"boolean",currentValue:false}]}))};
 return {client,save,context:{client,capabilities:{runtime:"acp"},projects:[{id:"p",name:"项目甲"}],models:[],modelsQuery:{},skillsQuery:{data:{data:[]}},gitStatusQuery:{},globalSettings:{},t:(key:string)=>key,navigate:vi.fn()}};
}
beforeEach(async()=>{await page.viewport(1100,850);await webLanguage("zh-CN");await nativeLanguage("zh-CN");});
for(const [name,Container] of [["Web",Web],["Native",Native]] as const){
 it(`${name} 新建计划只保存 ACP 定义，失败保留草稿和请求身份`,async()=>{
  const h=fixture();h.save.mockRejectedValueOnce(new Error("network"));
  const screen=await render(<QueryClientProvider client={new QueryClient()}><Container {...{context:h.context,projectId:"p",temporary:false} as never}/></QueryClientProvider>);
  await screen.getByRole("button",{name:"新建计划",exact:true}).click();
  await screen.getByRole("textbox",{name:"计划名称",exact:true}).fill("每日巡检");await screen.getByRole("textbox",{name:"提示词",exact:true}).fill("检查项目");
  await screen.getByRole("combobox",{name:"智能体",exact:true}).selectOptions("claude");
  await expect.element(screen.getByRole("checkbox",{name:"允许写入",exact:true})).not.toBeChecked();
  await screen.getByRole("button",{name:"保存计划",exact:true}).click();await expect.element(screen.getByRole("alert")).toHaveTextContent("network");
  await expect.element(screen.getByRole("textbox",{name:"提示词",exact:true})).toHaveValue("检查项目");
  await screen.getByRole("button",{name:"保存计划",exact:true}).click();await expect.element(screen.getByRole("status")).toHaveTextContent("计划已保存");
  expect(h.save.mock.calls[0]?.[0]).toBe(h.save.mock.calls[1]?.[0]);expect(h.save.mock.calls[0]?.[1]).toMatchObject({definition:{name:"每日巡检",engine:"claude",values:{flag:false},projectId:"p",enabled:false,prompt:{text:"检查项目"}},expectedRevision:0,expectedStateRevision:0,resources:[]});
  expect(h.save.mock.calls[0]?.[1]).not.toHaveProperty("turnOptions");
  await screen.unmount();
 });
}

for(const [name,Container] of [["Web",Web],["Native",Native]] as const){
it(`${name} 新草稿关闭有保护，窄屏无水平溢出，原有计划入口仍可展开`,async()=>{
 await page.viewport(390,844);const h=fixture();
 const screen=await render(<QueryClientProvider client={new QueryClient()}><Container {...{context:h.context,projectId:"p",temporary:false} as never}/></QueryClientProvider>);
 await screen.getByRole("button",{name:"新建计划",exact:true}).click();await screen.getByRole("textbox",{name:"计划名称",exact:true}).fill("未保存");
 const beforeUnload=new Event("beforeunload",{cancelable:true});window.dispatchEvent(beforeUnload);expect(beforeUnload.defaultPrevented).toBe(true);
 const dialog=screen.getByRole("dialog");await expect.poll(()=>dialog.element().getBoundingClientRect().right).toBeLessThanOrEqual(390);
 await expect.poll(()=>dialog.element().scrollWidth-dialog.element().clientWidth).toBeLessThanOrEqual(1);
 await screen.getByRole("button",{name:"取消",exact:true}).click();await expect.element(screen.getByRole("heading",{name:"放弃未保存的修改？"})).toBeVisible();
 await screen.getByRole("button",{name:"继续编辑",exact:true}).click();await expect.element(screen.getByRole("textbox",{name:"计划名称",exact:true})).toHaveValue("未保存");
 await screen.getByRole("button",{name:"取消",exact:true}).click();await screen.getByRole("button",{name:"放弃修改",exact:true}).click();
 await screen.getByRole("button",{name:"原有计划与运行记录",exact:true}).click();await expect.poll(()=>h.client.listScheduledTasks.mock.calls.length).toBeGreaterThan(0);
 await screen.unmount();
});

}

for(const [name,Container] of [["Web",Web],["Native",Native]] as const){
 it(`${name} 已有计划占用只读，明确重读后编辑携带双修订并保留已结束规则`,async()=>{
  const h=fixture();const definition={name:"已有巡检",projectId:"p",engine:"claude",values:{flag:false},enabled:false,prompt:{type:"prompt",text:"原正文",skills:[],attachments:[]},schedule:{type:"once",atUnixMs:1}};
  const view={source:"web",scheduleId:"saved",revision:3,definition,state:{revision:7,definitionRevision:3,nextRunAt:null},canEdit:false,resources:[]};
  h.client.listAcpPlans.mockResolvedValue({data:[{...view,...definition,stateRevision:7,scheduledRevision:3,nextRunAt:null}],nextCursor:null} as never);
  h.client.readAcpPlan.mockResolvedValueOnce(view as never).mockResolvedValueOnce({...view,canEdit:true} as never).mockResolvedValueOnce({...view,canEdit:true} as never);
  const screen=await render(<QueryClientProvider client={new QueryClient()}><Container {...{context:h.context,projectId:"p",temporary:false} as never}/></QueryClientProvider>);
  await screen.getByRole("button",{name:/已有巡检/}).click();await expect.element(screen.getByRole("textbox",{name:"计划名称",exact:true})).toBeDisabled();
  await screen.getByRole("button",{name:"重新读取",exact:true}).click();await expect.element(screen.getByRole("textbox",{name:"计划名称",exact:true})).toBeEnabled();
  await screen.getByRole("combobox",{name:"重复规则",exact:true}).selectOptions("daily");
  await screen.getByRole("button",{name:"重新读取",exact:true}).click();await screen.getByRole("button",{name:"放弃修改",exact:true}).click();
  await expect.element(screen.getByRole("combobox",{name:"重复规则",exact:true})).toHaveValue("once");
  await screen.getByRole("textbox",{name:"计划名称",exact:true}).fill("改名保留规则");await screen.getByRole("button",{name:"保存计划",exact:true}).click();
  await expect.element(screen.getByRole("status")).toHaveTextContent("计划已保存");
  await expect.poll(()=>h.save.mock.calls.length).toBe(1);expect(h.save.mock.calls[0]?.[1]).toMatchObject({expectedRevision:3,expectedStateRevision:7,definition:{schedule:{type:"once",atUnixMs:1},name:"改名保留规则"}});
  await screen.unmount();
 });
}
it("附件先上传和暂存，保存只携带私有资源引用，提交期间不允许编辑",async()=>{
 const h=fixture();const attachment={id:"uploaded",kind:"file",name:"说明.txt",mediaType:"text/plain",size:5};
 h.client.uploadAttachment=vi.fn(async()=>({attachment}));h.client.stageAcpPlanAttachment.mockResolvedValue({token:"token",attachment:{...attachment,id:"private"},digest:"a".repeat(64),written:5,boundRevision:null} as never);
 const screen=await render(<QueryClientProvider client={new QueryClient()}><Native {...{context:h.context,projectId:"p",temporary:false} as never}/></QueryClientProvider>);
 await screen.getByRole("button",{name:"新建计划",exact:true}).click();await screen.getByRole("textbox",{name:"计划名称",exact:true}).fill("带附件");await screen.getByRole("combobox",{name:"智能体",exact:true}).selectOptions("claude");
 let release!:()=>void;h.save.mockImplementationOnce((id,input)=>new Promise(resolve=>{release=()=>resolve({source:"desktop",scheduleId:id,revision:1,definition:input.definition,state:{revision:1,definitionRevision:1,nextRunAt:null},canEdit:true,resources:[{token:"token",attachment:{...attachment,id:"private"},digest:"a".repeat(64),written:5,boundRevision:1}]});}));
 const input=screen.getByRole("button",{name:"保存计划",exact:true});await expect.element(input).toBeEnabled();
 const fileInput=screen.getByLabelText("添加附件",{exact:true}).element() as HTMLInputElement;
 const transfer=new DataTransfer();transfer.items.add(new File(["hello"],"说明.txt",{type:"text/plain"}));Object.defineProperty(fileInput,"files",{configurable:true,value:transfer.files});fileInput.dispatchEvent(new Event("change",{bubbles:true}));
 await expect.element(screen.getByText("说明.txt",{exact:true})).toBeVisible();await input.click();
 await expect.element(screen.getByRole("textbox",{name:"计划名称",exact:true})).toBeDisabled();release();await expect.element(screen.getByRole("status")).toHaveTextContent("计划已保存");
 await expect.poll(()=>h.save.mock.calls.length).toBe(1);expect(h.save.mock.calls[0]?.[1]).toMatchObject({resources:["token"],definition:{prompt:{attachments:[{id:"private"}]}}});await screen.unmount();
});

it("StrictMode 与英文界面保持编辑会话可用，关闭后迟到预览不能污染重开草稿",async()=>{
 await nativeLanguage("en");const h=fixture();let resolve!:(value:never)=>void;h.client.previewAcpConfig.mockImplementationOnce(()=>new Promise(done=>{resolve=done}));
 const screen=await render(<StrictMode><QueryClientProvider client={new QueryClient()}><Native {...{context:h.context,projectId:"p",temporary:false} as never}/></QueryClientProvider></StrictMode>);
 await screen.getByRole("button",{name:"New schedule",exact:true}).click();await screen.getByRole("textbox",{name:"Schedule name",exact:true}).fill("Draft");await screen.getByRole("combobox",{name:"Agent",exact:true}).selectOptions("claude");
 await screen.getByRole("button",{name:"Cancel",exact:true}).click();await screen.getByRole("button",{name:"Discard changes",exact:true}).click();
 resolve({values:{flag:true},configOptions:[]} as never);
 await screen.getByRole("button",{name:"New schedule",exact:true}).click();await expect.element(screen.getByRole("textbox",{name:"Schedule name",exact:true})).toHaveValue("");
 await expect.element(screen.getByRole("combobox",{name:"Agent",exact:true})).toHaveValue("");await screen.unmount();
});
