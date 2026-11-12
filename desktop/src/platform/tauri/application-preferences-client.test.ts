import { expect,it,vi } from "vitest";
import { TauriCatalogClient } from "./catalog-client.js";
import type { InvokeImplementation } from "./native-client.js";
const preferences={defaultAgent:"codex",defaultModel:null,commitMessagePrompt:"",taskTitlePrompt:"",
  promptOptimizationPrompt:"",defaultOpenAppId:null,followUpBehavior:"queue",pet:{enabled:false,selectedPetId:null}};
it("本地偏好 IPC 不启动引擎或事件，拒绝坏响应并在调用前支持取消",async()=>{
  const invoke=vi.fn().mockResolvedValueOnce(preferences).mockResolvedValueOnce(preferences)
    .mockResolvedValueOnce({...preferences,model:"legacy"});
  const ensureRuntime=vi.fn(),connectEvents=vi.fn();
  const client=new TauriCatalogClient({invoke:invoke as InvokeImplementation,ensureRuntime,connectEvents});
  expect(await client.getApplicationPreferences()).toEqual(preferences);
  await client.patchApplicationPreferences({followUpBehavior:"steer"});
  expect(invoke).toHaveBeenNthCalledWith(1,"application_preferences_request",{request:{type:"read"}});
  expect(invoke).toHaveBeenNthCalledWith(2,"application_preferences_request",{request:{type:"patch",changes:{followUpBehavior:"steer"}}});
  expect(ensureRuntime).not.toHaveBeenCalled(); expect(connectEvents).not.toHaveBeenCalled();
  await expect(client.getApplicationPreferences()).rejects.toThrow("Invalid application preferences response");
  await expect(client.getApplicationPreferences({signal:AbortSignal.abort()})).rejects.toThrow("abort");
  expect(invoke).toHaveBeenCalledTimes(3);
});
