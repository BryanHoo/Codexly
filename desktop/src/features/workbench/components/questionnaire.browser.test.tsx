import { useState } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { Questionnaire } from "@codexly/ui/core/questionnaire";
import { QuestionnaireChoice } from "@codexly/ui/core/questionnaire-choice";
import "../../../shared/styles/globals.css";
import "../../../shared/styles/workbench.css";

const labels = { previous: "上一题", next: "下一题", progress: (current: number, total: number) => `第 ${current} / ${total} 题` };

test("逐题导航保留答案，阻止无效步骤和重复提交，并聚焦新题目", async () => {
  const submit = vi.fn();
  function Harness() {
    const [choice, setChoice] = useState(false);
    const [text, setText] = useState("");
    return <Questionnaire labels={labels} submitLabel="提交回答" onSubmit={submit}
      items={[
        { id: "scope", title: "选择范围", complete: choice, content: <QuestionnaireChoice name="scope" value="all" checked={choice} onChange={() => setChoice(true)}>全部文件</QuestionnaireChoice> },
        { id: "detail", title: "补充要求", content: <input aria-label="补充要求" required minLength={3} value={text} onChange={e => setText(e.target.value)} /> },
      ]} />;
  }
  const screen = await render(<Harness />);
  await expect.element(screen.getByRole("button", {name:"下一题"})).toBeDisabled();
  await screen.getByRole("radio", {name:"全部文件"}).click();
  await screen.getByRole("button", {name:"下一题"}).click();
  await expect.element(screen.getByRole("textbox", {name:"补充要求"})).toBeVisible();
  expect(document.activeElement?.tagName).toBe("FIELDSET");
  await screen.getByRole("button", {name:"提交回答"}).click();
  expect(submit).not.toHaveBeenCalled();
  await screen.getByRole("textbox", {name:"补充要求"}).fill("保留原有测试");
  await screen.getByRole("button", {name:"上一题"}).click();
  await expect.element(screen.getByRole("radio", {name:"全部文件"})).toBeChecked();
  await screen.getByRole("button", {name:"下一题"}).click();
  await expect.element(screen.getByRole("textbox", {name:"补充要求"})).toHaveValue("保留原有测试");
  await screen.getByRole("button", {name:"提交回答"}).click();
  expect(submit).toHaveBeenCalledOnce();
});

import { PendingRequestCard } from "./pending-request.js";
import { McpElicitationRequestCard } from "./mcp-elicitation-request.js";
import type { PendingRequest } from "@/protocol/index.js";

const identity = { createdAt: "2026-10-27T00:00:00Z", expiresAt: null, itemId: "input-1", projectId: "p", requestId: "request-1", status: "pending", taskId: "task", turnId: "turn" } as const;

test("用户输入问卷保留多选与自定义答案，密码字段遮蔽并在失败后允许重试", async () => {
  const onResolve = vi.fn().mockRejectedValueOnce(new Error("retry")).mockResolvedValue(undefined);
  const request: Extract<PendingRequest, { type: "user_input" }> = { ...identity, type: "user_input", questions: [
    { id: "scope", header: "范围", prompt: "选择检查内容", type: "choice", multiSelect: true, isOther: true, isSecret: false,
      options: [{ label: "源码", description: "检查实现" }, { label: "测试", description: "检查用例" }] },
    { id: "token", header: "令牌", prompt: "输入访问令牌", type: "short_text", isOther: false, isSecret: true, options: [] },
  ] };
  const screen = await render(<PendingRequestCard request={request} interactive onResolve={onResolve} />);
  await screen.getByRole("checkbox", {name:/源码/u}).click();
  await screen.getByRole("checkbox", {name:/测试/u}).click();
  await screen.getByRole("textbox").fill("文档");
  await screen.getByRole("button", {name:/下一题|Next question/u}).click();
  const password = screen.getByLabelText("输入访问令牌");
  await expect.element(password).toHaveAttribute("type", "password");
  await password.fill("private-token");
  await screen.getByRole("button", {name:/上一题|Previous question/u}).click();
  await expect.element(screen.getByRole("checkbox", {name:/源码/u})).toBeChecked();
  await expect.element(screen.getByRole("textbox")).toHaveValue("文档");
  await screen.getByRole("button", {name:/下一题|Next question/u}).click();
  await screen.getByRole("button", {name:/提交回答|Submit answers/u}).click();
  await expect.element(screen.getByRole("button", {name:/提交回答|Submit answers/u})).toBeEnabled();
  await screen.getByRole("button", {name:/提交回答|Submit answers/u}).click();
  expect(onResolve).toHaveBeenCalledTimes(2);
  expect(onResolve.mock.calls[1]?.[1]).toEqual({answers:{scope:["源码","测试","文档"],token:["private-token"]}});
  expect(onResolve.mock.calls[0]?.[2]).toBe(onResolve.mock.calls[1]?.[2]);
});

test("MCP 分步表单保留数值边界和多选约束，取消按钮不触发表单校验", async () => {
  const onResolve = vi.fn().mockResolvedValue(undefined);
  const request: Extract<PendingRequest, { type: "mcp_elicitation"; mode: "form" }> = { ...identity, type: "mcp_elicitation", mode:"form", serverName:"deploy", message:"配置部署", fields:[
    {id:"count",title:"副本数",description:null,type:"integer",required:true,minimum:1,maximum:3,defaultValue:null},
    {id:"checks",title:"选择检查项",description:null,type:"multi_select",required:true,minimum:2,maximum:2,defaultValue:[],options:[{label:"构建",value:"build"},{label:"测试",value:"test"}]},
  ]};
  const screen = await render(<McpElicitationRequestCard request={request} interactive onResolve={onResolve} />);
  await screen.getByRole("spinbutton", {name:"副本数"}).fill("5");
  await screen.getByRole("button", {name:/下一题|Next question/u}).click();
  await expect.element(screen.getByRole("spinbutton", {name:"副本数"})).toBeVisible();
  expect(onResolve).not.toHaveBeenCalled();
  await screen.getByRole("spinbutton", {name:"副本数"}).fill("2");
  await screen.getByRole("button", {name:/下一题|Next question/u}).click();
  await screen.getByRole("checkbox", {name:"构建"}).click();
  await screen.getByRole("button", {name:/提交回答|Submit answers/u}).click();
  expect(onResolve).not.toHaveBeenCalled();
  await screen.getByRole("checkbox", {name:"测试",exact:true}).click();
  await screen.getByRole("button", {name:/提交回答|Submit answers/u}).click();
  expect(onResolve.mock.calls[0]?.[1]).toEqual({action:"accept",content:{count:2,checks:["build","test"]}});
});

import { PendingRequestDock } from "./pending-request-dock.js";
import { questionTask } from "./async-question-test-fixtures.js";

test("输入框上方的请求区保持审批顺序，断线时锁定回答", async () => {
  const first: Extract<PendingRequest, {type:"user_input"}> = {...identity,type:"user_input",questions:[{id:"q",header:"范围",prompt:"选择范围",type:"choice",isOther:false,isSecret:false,options:[{label:"当前文件",description:"仅修改当前文件"}]}]};
  const second = {...first,requestId:"request-2",questions:[{...first.questions[0]!,id:"q2",prompt:"选择测试"}]};
  const store = questionTask([]);
  store.setState({pendingRequestIds:[first.requestId,second.requestId],pendingRequestsById:{[first.requestId]:first,[second.requestId]:second}});
  const onResolve = vi.fn().mockResolvedValue(undefined);
  const screen = await render(<PendingRequestDock store={store} connected onResolve={onResolve} />);
  const radios = screen.getByRole("radio");
  await expect.element(radios.nth(0)).toBeEnabled();
  await expect.element(radios.nth(1)).toBeDisabled();
  await screen.rerender(<PendingRequestDock store={store} connected={false} onResolve={onResolve} />);
  await expect.element(radios.nth(0)).toBeDisabled();
  expect(onResolve).not.toHaveBeenCalled();
});

test.each([true, false])("MCP 保留空字符串选项及无字段表单的确认能力：%s", async hasField => {
  const onResolve = vi.fn().mockResolvedValue(undefined);
  const request: Extract<PendingRequest, {type:"mcp_elicitation";mode:"form"}> = {...identity,type:"mcp_elicitation",mode:"form",serverName:"deploy",message:"确认配置",fields:hasField ? [
    {id:"suffix",type:"select",title:"部署后缀",required:true,description:null,defaultValue:null,options:[{label:"不设置后缀",value:""},{label:"测试后缀",value:"test"}]},
  ]:[]};
  const screen = await render(<McpElicitationRequestCard request={request} interactive onResolve={onResolve} />);
  if (hasField) await screen.getByRole("combobox", {name:"部署后缀"}).selectOptions("0");
  await screen.getByRole("button", {name:/提交回答|Submit answers/u}).click();
  expect(onResolve.mock.calls[0]?.[1]).toEqual({action:"accept",content:hasField?{suffix:""}:{}});
});
