import { expect, it, vi } from "vitest";
import { TauriRuntimeClient } from "./runtime-client.js";
import type { InvokeImplementation } from "./native-client.js";

it("ACP 辅助生成按本地能力传递显式标记，支持取消且不预热旧 Codex",async()=>{
  const invoke=vi.fn().mockResolvedValue({text:"结果"});
  const ensure=vi.fn(),events=vi.fn();
  const client=new TauriRuntimeClient({invoke:invoke as InvokeImplementation,ensureRuntime:ensure,connectEvents:events});
  const capabilities=await client.getCapabilities();
  vi.spyOn(client,"getCapabilities").mockResolvedValue({...capabilities,runtime:"acp"});
  await client.optimizePrompt("p","input");
  expect(invoke).toHaveBeenLastCalledWith("optimize_prompt",{projectId:"p",text:"input",agentRuntime:"acp"});
  await client.generateCommitMessage("p","/root",{engine:"codex",paths:["a"],expectedSnapshot:"a".repeat(64)});
  expect(invoke).toHaveBeenLastCalledWith("generate_commit_message",expect.objectContaining({agentRuntime:"acp"}));
  expect(ensure).not.toHaveBeenCalled();expect(events).not.toHaveBeenCalled();
  invoke.mockImplementation(()=>new Promise(()=>{}));
  const stop=new AbortController();const pending=client.optimizePrompt("p","input",{signal:stop.signal});
  await vi.waitFor(()=>expect(invoke).toHaveBeenCalledWith("optimize_prompt",expect.objectContaining({requestId:expect.any(String)})));
  stop.abort();await expect(pending).rejects.toThrow("aborted");
  expect(invoke).toHaveBeenLastCalledWith("cancel_native_request",{requestId:expect.any(String)});
});
