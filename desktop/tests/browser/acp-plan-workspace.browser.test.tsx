import type { ReactNode } from "react";
import { TooltipProvider } from "@codexly/ui/core/tooltip";
import { ComposerDraftProvider as WebDraft } from "../../../apps/web/src/features/workbench/composer-draft-context.js";
import { ComposerDraftProvider as NativeDraft } from "../../src/features/workbench/composer-draft-context.js";
import { ProjectTodoProvider } from "../../../apps/web/src/features/workbench/project-todo-context.js";
import { ProjectDraftProvider } from "../../src/features/workbench/project-draft-context.js";
import "../../src/shared/styles/workbench.css";
import { warmAcpPreviews } from "../../../packages/ui/src/core/acp-preview-cache.js";
import {StrictMode} from "react";
import {beforeEach,expect,it,vi} from "vitest";
import {page} from "vitest/browser";
import {render} from "vitest-browser-react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {Toaster} from "@codexly/ui/core/toaster";
import {SelectedEnginesContext} from "@codexly/ui/core/engine-selection";
import {ScheduledTasksContainer as Web} from "../../../apps/web/src/features/scheduled-tasks/scheduled-tasks-container.js";
import {ScheduledTasksContainer as Native} from "../../src/features/scheduled-tasks/scheduled-tasks-container.js";
import "../../src/shared/styles/globals.css";
import {changeAppLanguage as webLanguage} from "../../../apps/web/src/i18n/i18n.js";
import {changeAppLanguage as nativeLanguage} from "../../src/i18n/i18n.js";
vi.mock("../../../apps/web/src/features/access/access-context.js", async (original) => ({
  ...(await original()),
  useAccess: () => ({ status: { role: "owner" } }),
}));

function ComposerProviders({ children }: { children: ReactNode }) {
  return <TooltipProvider><SelectedEnginesContext value={["claude"]}><ProjectTodoProvider><WebDraft><ProjectDraftProvider><NativeDraft>
    {children}
  </NativeDraft></ProjectDraftProvider></WebDraft></ProjectTodoProvider></SelectedEnginesContext></TooltipProvider>;
}

function fixture(){
 const save=vi.fn(async(id:string,input:Record<string,unknown>)=>({source:"web",scheduleId:id,revision:Number(input.expectedRevision)+1,definition:input.definition,state:{revision:Number(input.expectedStateRevision)+1,definitionRevision:Number(input.expectedRevision)+1,nextRunAt:null},canEdit:true,resources:[]}));
 const client={subscribeAcpPlans:vi.fn(()=>()=>{}),previewScheduledTask: vi.fn(async () => ({ dates: [Date.now() + 60000] })), submitTask: vi.fn(), createAcpTask: vi.fn(), readAcpPlanHistory: vi.fn(async () => ({ projectId:"p",data:[] })), listScheduledTasks:vi.fn(async()=>({data:[]})),subscribeScheduledTasks:vi.fn(()=>()=>{}),listAcpPlans:vi.fn(async()=>({data:[],nextCursor:null})),saveAcpPlan:save,uploadAttachment:vi.fn(),stageAcpPlanAttachment:vi.fn(),readAcpPlan:vi.fn(),deleteAcpPlan:vi.fn(),previewAcpConfig:vi.fn(async()=>({values:{flag:false},configOptions:[{id:"flag",name:"允许写入",type:"boolean",currentValue:false}]}))};
 return {client,save,context:{client,capabilities:{runtime:"acp",tasks:{start:true},turns:{start:true},skills:{list:false,use:false}},projects:[{id:"p",name:"项目甲"}],models:[],modelsQuery:{},skillsQuery:{data:{data:[]}},gitStatusQuery:{},globalSettings:{},t:(key:string)=>key,navigate:vi.fn()}};
}
beforeEach(async()=>{await page.viewport(1100,850);await webLanguage("zh-CN");await nativeLanguage("zh-CN");});
it.each([["Web",Web],["Native",Native]] as const)("%s 在历史双栏中编辑目录已启用的 ACP Agent",async(_name,Container)=>{
 const h=fixture();
 const screen=await render(<QueryClientProvider client={new QueryClient()}><ComposerProviders><SelectedEnginesContext value={["acp-antigravity"]}><Container {...{context:h.context,projectId:"p",temporary:false} as never}/></SelectedEnginesContext></ComposerProviders></QueryClientProvider>);
 await screen.getByRole("button",{name:"新建计划",exact:true}).click();
 const agent=screen.getByRole("button",{name:/antigravity/});
 await expect.element(agent).toBeVisible();
 const list=document.querySelector(".scheduled-task-list");
 const editor=agent.element().closest(".scheduled-task-editor");
 expect(list).not.toBeNull();
 expect(editor).not.toBeNull();
 expect(editor!.getBoundingClientRect().left).toBeGreaterThan(list!.getBoundingClientRect().left);
 expect(agent.element().closest('[role="dialog"]')).toBeNull();
 await screen.getByRole("textbox",{name:"任务输入",exact:true}).fill("检查项目");
 await screen.getByRole("textbox",{name:"计划名称",exact:true}).fill("定期巡检");
 await screen.getByRole("button",{name:"新建计划",exact:true}).click();
 await expect.element(screen.getByRole("heading",{name:"放弃未保存的修改？"})).toBeVisible();
 await screen.getByRole("button",{name:"继续编辑",exact:true}).click();
 await screen.getByRole("button",{name:"保存计划",exact:true}).click();
 await expect.poll(()=>h.save.mock.calls[0]?.[1]).toMatchObject({definition:{engine:"acp-antigravity"}});
 await screen.unmount();
});
for(const [name,Container] of [["Web",Web],["Native",Native]] as const){
 it(`${name} 新建计划只保存 ACP 定义，失败保留草稿和请求身份`,async()=>{
  const h=fixture();h.save.mockRejectedValueOnce(new Error("network"));
  const cache=new QueryClient();
  await warmAcpPreviews(cache, ["claude"], h.client.previewAcpConfig);
  h.client.previewAcpConfig.mockClear();
  const screen=await render(<QueryClientProvider client={cache}><Toaster /><ComposerProviders><Container {...{context:h.context,projectId:"p",temporary:false} as never}/></ComposerProviders></QueryClientProvider>);
  await screen.getByRole("button",{name:"新建计划",exact:true}).click();
  await screen.getByRole("textbox",{name:"计划名称",exact:true}).fill("每日巡检");await screen.getByRole("textbox",{name:"任务输入",exact:true}).fill("检查项目");
  await expect.element(screen.getByRole("button",{name:/Claude/})).toBeVisible();
  await screen.getByRole("button",{name:"保存计划",exact:true}).click();await expect.element(screen.getByRole("alert")).toHaveTextContent("network");
  await expect.element(screen.getByRole("textbox",{name:"任务输入",exact:true})).toHaveValue("检查项目");
  await screen.getByRole("button",{name:"保存计划",exact:true}).click();await expect.element(page.getByText("计划已保存",{exact:true})).toBeVisible();
  expect(document.querySelector('[data-slot="toast-title"]')?.textContent).toBe("计划已保存");
  expect(h.save.mock.calls[0]?.[0]).toBe(h.save.mock.calls[1]?.[0]);expect(h.save.mock.calls[0]?.[1]).toMatchObject({definition:{name:"每日巡检",engine:"claude",values:{},projectId:"p",enabled:false,prompt:{text:"检查项目"}},expectedRevision:0,expectedStateRevision:0,resources:[]});
  expect(h.save.mock.calls[0]?.[1]).not.toHaveProperty("turnOptions");
  expect(h.client.previewAcpConfig).not.toHaveBeenCalled();
  expect(h.client.submitTask).not.toHaveBeenCalled();
  expect(h.client.createAcpTask).not.toHaveBeenCalled();
  cache.clear();
  await screen.unmount();
 });
}

for(const [name,Container] of [["Web",Web],["Native",Native]] as const){
it(`${name} 新草稿关闭有保护，窄屏无水平溢出，原有计划入口仍可展开`,async()=>{
 await page.viewport(390,844);const h=fixture();
 const screen=await render(<QueryClientProvider client={new QueryClient()}><ComposerProviders><Container {...{context:h.context,projectId:"p",temporary:false} as never}/></ComposerProviders></QueryClientProvider>);
 await screen.getByRole("button",{name:"新建计划",exact:true}).click();await screen.getByRole("textbox",{name:"计划名称",exact:true}).fill("未保存");
 const beforeUnload=new Event("beforeunload",{cancelable:true});window.dispatchEvent(beforeUnload);expect(beforeUnload.defaultPrevented).toBe(true);
 const editor=screen.getByRole("region",{name:"新建计划"});await expect.poll(()=>editor.element().getBoundingClientRect().right).toBeLessThanOrEqual(390);
 await expect.poll(()=>editor.element().scrollWidth-editor.element().clientWidth).toBeLessThanOrEqual(1);
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
  const screen=await render(<QueryClientProvider client={new QueryClient()}><Toaster /><ComposerProviders><Container {...{context:h.context,projectId:"p",temporary:false} as never}/></ComposerProviders></QueryClientProvider>);
  await screen.getByRole("button",{name:"已有巡检",exact:true}).click();await expect.element(screen.getByRole("textbox",{name:"计划名称",exact:true})).toBeDisabled();
  await screen.getByRole("button",{name:"重新读取",exact:true}).click();await expect.element(screen.getByRole("textbox",{name:"计划名称",exact:true})).toBeEnabled();
  await screen.getByRole("combobox",{name:"重复规则",exact:true}).selectOptions("daily");
  await screen.getByRole("button",{name:"重新读取",exact:true}).click();await screen.getByRole("button",{name:"放弃修改",exact:true}).click();
  await expect.element(screen.getByRole("combobox",{name:"重复规则",exact:true})).toHaveValue("once");
  await screen.getByRole("textbox",{name:"计划名称",exact:true}).fill("改名保留规则");await screen.getByRole("button",{name:"保存计划",exact:true}).click();
  await expect.element(page.getByText("计划已保存",{exact:true})).toBeVisible();
  expect(document.querySelector('[data-slot="toast-title"]')?.textContent).toBe("计划已保存");
  await expect.poll(()=>h.save.mock.calls.length).toBe(1);expect(h.save.mock.calls[0]?.[1]).toMatchObject({expectedRevision:3,expectedStateRevision:7,definition:{schedule:{type:"once",atUnixMs:1},name:"改名保留规则"}});
  await screen.unmount();
 });
}
it("附件先上传和暂存，保存只携带私有资源引用，提交期间不允许编辑",async()=>{
 const h=fixture();const attachment={id:"uploaded",kind:"file",name:"说明.txt",mediaType:"text/plain",size:5};
 h.client.uploadAttachment=vi.fn(async()=>({attachment}));h.client.stageAcpPlanAttachment.mockResolvedValue({token:"token",attachment:{...attachment,id:"private"},digest:"a".repeat(64),written:5,boundRevision:null} as never);
 const screen=await render(<QueryClientProvider client={new QueryClient()}><Toaster /><ComposerProviders><Native {...{context:h.context,projectId:"p",temporary:false} as never}/></ComposerProviders></QueryClientProvider>);
 await screen.getByRole("button",{name:"新建计划",exact:true}).click();await screen.getByRole("textbox",{name:"计划名称",exact:true}).fill("带附件");
 let release!:()=>void;h.save.mockImplementationOnce((id,input)=>new Promise(resolve=>{release=()=>resolve({source:"desktop",scheduleId:id,revision:1,definition:input.definition,state:{revision:1,definitionRevision:1,nextRunAt:null},canEdit:true,resources:[{token:"token",attachment:{...attachment,id:"private"},digest:"a".repeat(64),written:5,boundRevision:1}]});}));
 const input=screen.getByRole("button",{name:"保存计划",exact:true});
 await expect.element(screen.getByRole("textbox",{name:"任务输入",exact:true})).toBeVisible();
 const fileInput=document.querySelector<HTMLInputElement>('[data-prompt-input-picker="file"]')!;
 const transfer=new DataTransfer();transfer.items.add(new File(["hello"],"说明.txt",{type:"text/plain"}));Object.defineProperty(fileInput,"files",{configurable:true,value:transfer.files});fileInput.dispatchEvent(new Event("change",{bubbles:true}));
 await expect.element(screen.getByText("说明.txt",{exact:true})).toBeVisible();await input.click();
 await expect.element(screen.getByRole("textbox",{name:"计划名称",exact:true})).toBeDisabled();release();await expect.element(page.getByText("计划已保存",{exact:true})).toBeVisible();
  expect(document.querySelector('[data-slot="toast-title"]')?.textContent).toBe("计划已保存");
 await expect.poll(()=>h.save.mock.calls.length).toBe(1);expect(h.save.mock.calls[0]?.[1]).toMatchObject({resources:["token"],definition:{prompt:{attachments:[{id:"private"}]}}});await screen.unmount();
});

it("StrictMode 与英文界面保持编辑会话可用，关闭后迟到的启动缓存不能污染重开草稿",async()=>{
 await nativeLanguage("en");const h=fixture();const cache=new QueryClient();const startup=Promise.withResolvers<Awaited<ReturnType<typeof h.client.previewAcpConfig>>>();
 const warm=warmAcpPreviews(cache, ["claude"], () => startup.promise);
 const screen=await render(<StrictMode><QueryClientProvider client={cache}><ComposerProviders><Native {...{context:h.context,projectId:"p",temporary:false} as never}/></ComposerProviders></QueryClientProvider></StrictMode>);
 await screen.getByRole("button",{name:"New schedule",exact:true}).click();await screen.getByRole("textbox",{name:"Schedule name",exact:true}).fill("Draft");
 await screen.getByRole("button",{name:"Cancel",exact:true}).click();await screen.getByRole("button",{name:"Discard changes",exact:true}).click();
 startup.resolve({values:{flag:true},configOptions:[]});
 await warm;
 await screen.getByRole("button",{name:"New schedule",exact:true}).click();await expect.element(screen.getByRole("textbox",{name:"Schedule name",exact:true})).toHaveValue("");
 await expect.element(screen.getByRole("textbox",{name:"Task input",exact:true})).toHaveValue("");await screen.unmount();cache.clear();
});

for(const [name,Container] of [["Web",Web],["Native",Native]] as const){
 it(`${name} 连续通知合并读取且不取消编辑加载或覆盖草稿`,async()=>{
  const h=fixture();const listeners=new Set<()=>void>();h.client.subscribeAcpPlans=vi.fn((listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};});
  const definition={name:"已有计划",projectId:"p",engine:"claude",values:{flag:false},enabled:false,prompt:{type:"prompt",text:"原正文",skills:[],attachments:[]},schedule:{type:"once",atUnixMs:1}};
  const view={source:"web",scheduleId:"saved",revision:1,definition,state:{revision:1,definitionRevision:1,nextRunAt:null},canEdit:true,resources:[]};
  const row={...view,...definition,nextRunAt:null,stateRevision:1,scheduledRevision:1};const data={data:[row],nextCursor:null};h.client.listAcpPlans.mockResolvedValue(data as never);
  let editDone!:(value:never)=>void;let editSignal:AbortSignal|undefined;
  h.client.readAcpPlan.mockImplementationOnce((_id:string,options:{signal:AbortSignal})=>{editSignal=options.signal;return new Promise(resolve=>{editDone=resolve;});});
  const screen=await render(<QueryClientProvider client={new QueryClient()}><ComposerProviders><Container {...{context:h.context,projectId:"p",temporary:false} as never}/></ComposerProviders></QueryClientProvider>);
  await screen.getByRole("button",{name:"已有计划",exact:true}).click();
  let listDone!:(value:never)=>void;h.client.listAcpPlans.mockImplementationOnce(()=>new Promise(resolve=>{listDone=resolve;}));
  for(let i=0;i<20;i++)for(const listener of listeners)listener();
  expect(h.client.listAcpPlans).toHaveBeenCalledTimes(2);expect(editSignal?.aborted).toBe(false);
  editDone(view as never);await screen.getByRole("textbox",{name:"计划名称",exact:true}).fill("保持此草稿");
  listDone(data as never);await expect.poll(()=>h.client.listAcpPlans.mock.calls.length).toBe(3);
  await expect.element(screen.getByRole("textbox",{name:"计划名称",exact:true})).toHaveValue("保持此草稿");expect(h.client.readAcpPlan).toHaveBeenCalledOnce();
  await screen.unmount();
 });
}
