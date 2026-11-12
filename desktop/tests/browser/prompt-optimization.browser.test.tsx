import { useState } from "react";
import { optimizeButton as webOptimizeButton } from "../../../apps/web/src/features/workbench/components/workbench-composer-followup.js";
import { createComposerOptimizationButton as nativeOptimizeButton } from "../../src/features/workbench/components/workbench-composer-followup.js";
import { createPromptSkillContent } from "../../../apps/web/src/features/workbench/components/prompt-skill-content.js";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { PromptOptimizationButton } from "@codexly/ui/core/prompt-optimization-button";
import { GenerationPromptsSettings } from "@codexly/ui/core/generation-prompts-settings";
import { TooltipProvider } from "@codexly/ui/core/tooltip";
import "../../src/shared/styles/globals.css";

function Harness({ generate, onError = vi.fn() }: { generate: (text: string, signal: AbortSignal) => Promise<{ text: string }>; onError?: (error: Error) => void }) {
  const [text, setText] = useState("修复登录");
  const [scope, setScope] = useState("a");
  const [disabled, setDisabled] = useState(false);
  return <TooltipProvider><textarea aria-label="输入" value={text} onChange={(event) => setText(event.target.value)} /><PromptOptimizationButton language="zh-CN" scope={scope} text={text} disabled={disabled} generate={generate} replace={setText} onError={onError} /><button onClick={() => setScope("b")}>切换会话</button><button onClick={() => setDisabled(true)}>禁止编辑</button></TooltipProvider>;
}

it("自动回填优化文字且生成期间禁止重复点击", async () => {
  let resolve!: (value: { text: string }) => void;
  const generate = vi.fn(() => new Promise<{ text: string }>((done) => { resolve = done; }));
  const screen = await render(<Harness generate={generate} />);
  await screen.getByRole("button", { name: "AI 优化提示词" }).click();
  await expect.element(screen.getByRole("button", { name: "正在优化提示词…" })).toBeDisabled();
  resolve({ text: "明确登录失败原因并修复，验证登录流程。" });
  await expect.element(screen.getByRole("textbox", { name: "输入" })).toHaveValue("明确登录失败原因并修复，验证登录流程。");
  expect(generate).toHaveBeenCalledExactlyOnceWith("修复登录", expect.any(AbortSignal));
});

it.each(["edit", "switch"])("迟到结果不能覆盖变化后的草稿：%s", async (action) => {
  let resolve!: (value: { text: string }) => void;
  const screen = await render(<Harness generate={() => new Promise((done) => { resolve = done; })} />);
  await screen.getByRole("button", { name: "AI 优化提示词" }).click();
  if (action === "edit") await screen.getByRole("textbox").fill("新的草稿");
  else await screen.getByRole("button", { name: "切换会话" }).click();
  resolve({ text: "旧优化结果" });
  await expect.element(screen.getByRole("button", { name: "AI 优化提示词" })).toBeEnabled();
  await expect.element(screen.getByRole("textbox")).toHaveValue(action === "edit" ? "新的草稿" : "修复登录");
});

it("失败保留原文并允许重试，空输入不可优化", async () => {
  const onError = vi.fn();
  const screen = await render(<Harness generate={() => Promise.reject(new Error("offline"))} onError={onError} />);
  await screen.getByRole("button", { name: "AI 优化提示词" }).click();
  await expect.poll(() => onError.mock.calls.length).toBe(1);
  await expect.element(screen.getByRole("textbox")).toHaveValue("修复登录");
  await screen.getByRole("textbox").fill("  ");
  await expect.element(screen.getByRole("button", { name: "AI 优化提示词" })).not.toBeInTheDocument();
  await screen.getByRole("textbox").fill("补充排查步骤");
  await expect.element(screen.getByRole("button", { name: "AI 优化提示词" })).toBeEnabled();
});

it("辅助生成设置提供可留空的输入优化提示词", async () => {
  const onChange = vi.fn();
  const screen = await render(<GenerationPromptsSettings language="zh-CN" settings={{ commitMessagePrompt: "" }} onChange={onChange} onFlush={() => {}} />);
  const input = screen.getByRole("textbox", { name: "输入优化提示词" });
  await expect.element(input).toHaveAttribute("placeholder", "留空时使用应用内置提示词。");
  await input.fill("保留原文语言");
  expect(onChange).toHaveBeenLastCalledWith("promptOptimizationPrompt", "保留原文语言");
});


it.each(["edit", "switch", "unmount", "disable"])("取消并释放输入优化请求，主动取消不报失败：%s", async(action)=>{
  let signal: AbortSignal | undefined;
  const onError=vi.fn();
  const generate=vi.fn((_text:string, stop:AbortSignal)=>{
    signal=stop;
    return new Promise<{text:string}>((_resolve,reject)=>stop?.addEventListener("abort",()=>reject(stop.reason),{once:true}));
  });
  const screen=await render(<Harness generate={generate} onError={onError} />);
  await screen.getByRole("button",{name:"AI 优化提示词"}).click();
  expect(signal).toBeInstanceOf(AbortSignal);
  if(action === "edit") await screen.getByRole("textbox").fill("新的草稿");
  else if(action === "switch") await screen.getByRole("button",{name:"切换会话"}).click();
  else if(action === "disable") await screen.getByRole("button",{name:"禁止编辑"}).click();
  else await screen.unmount();
  await expect.poll(()=>signal?.aborted).toBe(true);

  expect(onError).not.toHaveBeenCalled();
});


it.each([["Web",webOptimizeButton],["Native",nativeOptimizeButton]] as const)("%s composer 转发同一个取消信号至客户端",async(_platform,factory)=>{
  let received:AbortSignal|undefined;
  const optimizePrompt=vi.fn((_project:string,_text:string,options?:{signal?:AbortSignal})=>{
    received=options?.signal;
    return new Promise<{text:string}>((_resolve,reject)=>received?.addEventListener("abort",()=>reject(received?.reason),{once:true}));
  });
  const session={composerScope:"p:a",promptContent:createPromptSkillContent("修复登录"),draftInputDisabled:false,isSubmitting:false,setMutationError:vi.fn()};
  const screen=await render(<TooltipProvider>{factory(session as never,{optimizePrompt},"p",[],"zh-CN")}</TooltipProvider>);
  try {
    await screen.getByRole("button",{name:"AI 优化提示词"}).click();
    expect(optimizePrompt).toHaveBeenCalledWith("p","修复登录",{signal:expect.any(AbortSignal)});
  } finally {await screen.unmount();}
  expect(received?.aborted).toBe(true);
  expect(session.setMutationError).not.toHaveBeenCalled();
});
