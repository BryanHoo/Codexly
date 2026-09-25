import { Value } from "@sinclair/typebox/value";
import { expect, it } from "vitest";
import { AgentEventSchema, type AgentEvent, type AgentTaskSnapshotResponse } from "@/protocol/index.js";
import { createTaskItemKey, createTaskStore } from "./task-store.js";

it("按原生目标原位更新 Skill 和正文，不移动消息、不覆盖附件", () => {
  const response: AgentTaskSnapshotResponse = {
    checkpoint: { sessionId: "session", sequence: 0 },
    snapshot: {
      id:"task", projectId:"project", title:"Task", pinned:false, status:"running",
      updatedAt:"2026-09-12T00:00:00Z", contextUsage:null, plan:null, goal:null,
      pendingRequests:[], turnsNextCursor:null,
      settings:{approvalPolicy:"on-request", approvalsReviewer:"user", model:"model", reasoningEffort:"high", sandboxMode:"workspace-write"},
      turns:[{id:"turn", status:"running", startedAt:null, completedAt:null, error:null, items:[
        {id:"user", type:"message", role:"user", text:"$rust 修复代码", attachments:[{id:"file",kind:"file",name:"code.rs",mediaType:"text/plain",size:12}]},
        {id:"assistant", type:"message",role:"assistant",text:"处理中"},
      ]}],
    },
  };
  const event: AgentEvent = {
    version:2, provider:"codex", sessionId:"session", sequence:1, taskId:"task", turnId:"turn", itemId:"user",
    timestamp:response.snapshot.updatedAt, type:"message.skills_updated",
    payload:{text:"修复代码", skills:[{name:"rust"}]},
  };
  expect(Value.Check(AgentEventSchema, event)).toBe(true);
  const store = createTaskStore({projectId:"project", taskId:"task"}, response);
  const key = createTaskItemKey("turn", "user");
  const itemStore = store.getState().itemStoresByKey.get(key);
  store.getState().applyEvents([event, {...event, sequence:2}]);
  expect(store.getState().itemStoresByKey.get(key)).toBe(itemStore);
  expect(store.getState().reconstructSnapshot()?.turns[0]?.items).toEqual([
    {...response.snapshot.turns[0]?.items[0], text:"修复代码", skills:[{name:"rust"}]},
    response.snapshot.turns[0]?.items[1],
  ]);
  expect(store.getState().checkpoint?.sequence).toBe(2);
});
