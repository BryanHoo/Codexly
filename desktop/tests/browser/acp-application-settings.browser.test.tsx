import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { GlobalSettingsPage as WebPage } from "../../../apps/web/src/features/settings/components/global-settings-page.js";
import { GlobalSettingsPage as NativePage } from "../../src/features/settings/components/global-settings-page.js";
import { WorkbenchSettingsPage as WebContainer } from "../../../apps/web/src/features/workbench/components/workbench-settings-page.js";
import { WorkbenchSettingsPage as NativeContainer } from "../../src/features/workbench/components/workbench-settings-page.js";
import { useApplicationSettings } from "@codexly/ui/core/use-application-settings";
import { nativeClient } from "../../src/features/projects/project-queries.js";
import { changeAppLanguage as webLanguage } from "../../../apps/web/src/i18n/i18n.js";
import { changeAppLanguage as nativeLanguage } from "../../src/i18n/i18n.js";
import { SelectedEnginesContext } from "@codexly/ui/core/engine-selection";
import { TooltipProvider } from "@codexly/ui/core/tooltip";
import { Toaster } from "@codexly/ui/core/toaster";
import type { ApplicationPreferences } from "@codexly/protocol/application-preferences";
import type { SettingsClient } from "../../../apps/web/src/features/settings/components/global-settings-page-contracts.js";
import "../../src/shared/styles/globals.css";
import { createFallbackSettings as legacySettings } from "../../../apps/web/src/features/settings/components/global-settings-model.js";
const preferences:ApplicationPreferences={defaultAgent:"codex",defaultModel:null,commitMessagePrompt:"",
  taskTitlePrompt:"",promptOptimizationPrompt:"",defaultOpenAppId:null,followUpBehavior:"queue",pet:{enabled:false,selectedPetId:null}};
const defaults={defaults:{},invalidDefaults:[],unmappedLegacy:[],configOptions:[
  {id:"native-model",category:"model",name:"模型",type:"select",currentValue:"raw/a",options:[
    {group:"provider",name:"原生供应商",options:[{value:"raw/a",name:"原始模型甲"},{value:"raw/b",name:"原始模型乙"}]}]},
]};
beforeEach(async()=>{await page.viewport(390,844);await webLanguage("zh-CN");await nativeLanguage("zh-CN");});
afterEach(()=>vi.restoreAllMocks());
for(const [platform,Page,Container] of [["Web",WebPage,WebContainer],["Native",NativePage,NativeContainer]] as const){
  it(`${platform}：ACP 辅助生成保持 null、不自动保存，直接选择原始分组模型`,async()=>{
    if (platform === "Native") await page.viewport(960,844);
    const getAcpDefaults=vi.fn(async()=>defaults);
    vi.spyOn(nativeClient,"getAcpDefaults").mockImplementation(getAcpDefaults as never);
    const onSave=vi.fn(async()=>undefined);
    const client={getAcpDefaults,getEngineProfile:vi.fn(()=>{throw new Error("旧模型不得被调用");})} as unknown as SettingsClient;
    const cache=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const screen=await render(<QueryClientProvider client={cache}><SelectedEnginesContext value={["codex","claude"]}><TooltipProvider>
      <div style={{height:"100dvh"}}><Page client={client} agentRuntime="acp" initialSection="git" apps={[]} error={null} isPending={false}
        models={[]} settings={preferences} onClose={()=>undefined} onRetry={()=>undefined} onSave={onSave}/></div>
    </TooltipProvider></SelectedEnginesContext></QueryClientProvider>);
    await expect.element(screen.getByText("沿用智能体默认",{exact:true})).toBeVisible();
    expect(onSave).not.toHaveBeenCalled();
    await screen.getByRole("combobox",{name:"默认模型",exact:true}).click();
    await page.getByRole("option",{name:"原始模型乙",exact:true}).click();
    await expect.poll(()=>onSave.mock.calls.length).toBe(1);
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({defaultAgent:"codex",defaultModel:"raw/b"});
    expect(onSave.mock.calls[0]?.[1]).toEqual(preferences);
    expect(getAcpDefaults).toHaveBeenCalledWith("codex",expect.any(Object));
    cache.clear();
  });
  it(`${platform}：未启用的引擎不探测、不自动覆盖原始选择`,async()=>{
    if(platform==="Native") await page.viewport(960,844);
    const getAcpDefaults=vi.fn(async()=>defaults);
    vi.spyOn(nativeClient,"getAcpDefaults").mockImplementation(getAcpDefaults as never);
    const onSave=vi.fn(async()=>undefined),saved={...preferences,defaultAgent:"claude" as const,defaultModel:"retained/raw"};
    const client={getAcpDefaults} as unknown as SettingsClient;
    const screen=await render(<QueryClientProvider client={new QueryClient()}><SelectedEnginesContext value={["codex"]}><TooltipProvider>
      <div style={{height:"100dvh"}}><Page client={client} agentRuntime="acp" initialSection="git" apps={[]} error={null} isPending={false}
        models={[]} settings={saved} onClose={()=>undefined} onRetry={()=>undefined} onSave={onSave}/></div>
    </TooltipProvider></SelectedEnginesContext></QueryClientProvider>);
    await expect.element(screen.getByRole("combobox",{name:"默认模型",exact:true})).toBeDisabled();
    expect(getAcpDefaults).not.toHaveBeenCalled();expect(onSave).not.toHaveBeenCalled();
    await screen.getByRole("combobox",{name:"默认 Agent",exact:true}).click();
    await page.getByRole("option",{name:"Codex",exact:true}).click();
    await expect.poll(()=>onSave.mock.calls.length).toBe(1);
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({defaultAgent:"codex",defaultModel:null});
  });
  it(`${platform}：失败重试保持基线与身份，不生成旧模型权限字段`,async()=>{
    if(platform==="Native") await page.viewport(960,844);
    const getAcpDefaults=vi.fn(async()=>defaults);
    vi.spyOn(nativeClient,"getAcpDefaults").mockImplementation(getAcpDefaults as never);
    const onSave=vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const client={getAcpDefaults} as unknown as SettingsClient;
    const screen=await render(<QueryClientProvider client={new QueryClient()}><TooltipProvider><div style={{height:"100dvh"}}><Toaster/>
      <Page client={client} agentRuntime="acp" initialSection="git" apps={[]} error={null} isPending={false} models={[]}
        settings={preferences} onSave={onSave} onRetry={()=>undefined} onClose={()=>undefined}/>
    </div></TooltipProvider></QueryClientProvider>);
    await screen.getByRole("textbox",{name:"任务标题提示词",exact:true}).fill("新的标题指令");
    await screen.getByRole("heading",{name:"辅助生成",exact:true}).click();
    await expect.poll(()=>onSave.mock.calls.length).toBe(1);
    await page.getByRole("button",{name:"重试",exact:true}).click();
    await expect.poll(()=>onSave.mock.calls.length).toBe(2);
    expect(onSave.mock.calls[0]).toEqual(onSave.mock.calls[1]);
    expect(onSave.mock.calls[0]?.[0]).toEqual({...preferences,taskTitlePrompt:"新的标题指令"});
    expect(onSave.mock.calls[0]?.[1]).toEqual(preferences);
    expect(onSave.mock.calls[0]?.[2]).toEqual(expect.any(String));
  });
  it(`${platform}：实际设置容器忽略已禁用旧模型查询的 pending 状态`,async()=>{
    if(platform==="Native") await page.viewport(960,844);
    const getAcpDefaults=vi.fn(async()=>defaults);
    vi.spyOn(nativeClient,"getAcpDefaults").mockImplementation(getAcpDefaults as never);
    const client={getAcpDefaults} as unknown as SettingsClient;
    const modelsRetry=vi.fn();
    const context={client,capabilities:{runtime:"acp"},globalSettingsSection:"git",
      globalSettingsQuery:{data:{settings:preferences},error:null,isPending:false,refetch:vi.fn()},
      modelsQuery:{isPending:true,isLoading:false,error:null,refetch:modelsRetry},models:[],
      globalSettingsMutation:{mutateAsync:vi.fn(async()=>undefined)},
      projectOpenCapabilitiesQuery:{data:{apps:[]},isPending:false,error:null},
      appInfoQuery:{error:null,isPending:false},appUpdateMutation:{isPending:false},appUpdateProgressQuery:{},
      access:{},queryClient:new QueryClient(),setGlobalSettingsSection:vi.fn(),fastModeAvailable:false};
    const screen=await render(<QueryClientProvider client={context.queryClient}><TooltipProvider><div style={{height:"100dvh"}}>
      <Container context={context as never} projectToolsEnabled={false}/>
    </div></TooltipProvider></QueryClientProvider>);
    await expect.element(screen.getByRole("textbox",{name:"任务标题提示词",exact:true})).toBeVisible();
    expect(modelsRetry).not.toHaveBeenCalled();
  });
}

it("共享设置 hook 在 ACP 保存前取消旧读取，仅写独立缓存且不刷新聊天默认值",async()=>{
  let finish!:(value:ApplicationPreferences)=>void;
  const client={getGlobalSettings:vi.fn(),updateGlobalSettings:vi.fn(),
    getApplicationPreferences:vi.fn(()=>new Promise<ApplicationPreferences>(resolve=>{finish=resolve;})),
    patchApplicationPreferences:vi.fn(async()=>({...preferences,taskTitlePrompt:"新值"}))};
  const afterLegacy=vi.fn(),cache=new QueryClient();
  cache.setQueryData(["application-preferences"],{settings:preferences});
  function Harness(){
    const state=useApplicationSettings(client,"codex","acp",afterLegacy);
    return <><button onClick={()=>void state.globalSettingsMutation.mutateAsync({baseline:preferences,settings:{...preferences,taskTitlePrompt:"新值"}})}>保存</button>
      <output>{state.globalSettingsQuery.data?.settings.taskTitlePrompt}</output></>;
  }
  const screen=await render(<QueryClientProvider client={cache}><Harness/></QueryClientProvider>);
  await expect.poll(()=>client.getApplicationPreferences.mock.calls.length).toBe(1);
  await screen.getByRole("button",{name:"保存",exact:true}).click();
  await expect.element(screen.getByRole("status")).toHaveTextContent("新值");
  finish(preferences);
  await expect.poll(()=>cache.getQueryData(["application-preferences"])).toEqual({settings:{...preferences,taskTitlePrompt:"新值"}});
  expect(client.getGlobalSettings).not.toHaveBeenCalled();expect(client.updateGlobalSettings).not.toHaveBeenCalled();
  expect(afterLegacy).not.toHaveBeenCalled();
});

it("Web：旧偏好省略 defaultAgent 时仍可首次保存，不丢失草稿基线",async()=>{
  const {defaultAgent:_agent,...settings}=legacySettings([]);
  const onSave=vi.fn(async()=>undefined);
  const client={} as SettingsClient;
  const warm=await render(<QueryClientProvider client={new QueryClient()}><TooltipProvider><div style={{height:"100dvh"}}>
    <WebPage client={client} initialSection="git" apps={[]} settings={legacySettings([])} models={[]} error={null} isPending={false}
      onSave={async()=>undefined} onClose={()=>undefined} onRetry={()=>undefined}/>
  </div></TooltipProvider></QueryClientProvider>);
  await expect.element(warm.getByRole("textbox",{name:"任务标题提示词",exact:true})).toBeVisible();
  await warm.unmount();
  await render(<QueryClientProvider client={new QueryClient()}><TooltipProvider><div style={{height:"100dvh"}}>
    <WebPage client={client} initialSection="git" apps={[]} settings={settings} models={[]} error={null} isPending={false}
      onSave={onSave} onClose={()=>undefined} onRetry={()=>undefined}/>
  </div></TooltipProvider></QueryClientProvider>);
  await expect.poll(()=>onSave.mock.calls.length).toBe(1);
  expect(onSave).toHaveBeenCalledWith({...settings,defaultAgent:"codex"});
});
