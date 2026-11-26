import { expect, it, vi } from "vitest";
import * as acp from "@agentclientprotocol/sdk/unstable";
import { fixture } from "./provider.test-support.js";

const oldTurn = {
  id: "old",
  status: "completed" as const,
  startedAt: null,
  completedAt: null,
  error: null,
  items: [
    { id: "old-reply", type: "message" as const, role: "assistant" as const, text: "原始历史正文" },
  ],
};

it.each(["codex", "claude"] as const)(
  "%s 未声明删除能力时保留原生绑定和历史，不调用 session/delete",
  async (engine) => {
    const remove = vi.fn(() => ({}));
    const f = await fixture(engine, undefined, undefined, { deleteSession: remove });
    f.tasks.set("t", {
      id: "t",
      provider: engine,
      projectId: "project",
      sessionId: "native-old",
      cwd: "/workspace",
      title: "历史",
      updatedAt: 1,
      archived: false,
      pinned: false,
      status: "idle",
    });
    await f.history.append("t", oldTurn);
    await expect(f.provider.deleteTask("t")).rejects.toThrow("不支持原生会话删除");
    expect(f.tasks.get("t")?.sessionId).toBe("native-old");
    expect((await f.history.read("t")).turns).toEqual([oldTurn]);
    expect(remove).not.toHaveBeenCalled();
    expect(f.loaded).not.toHaveBeenCalled();
    expect(f.created).not.toHaveBeenCalled();
  },
);

it.each(["success", "not-found"] as const)(
  "原生删除先确认，失败保留历史且可沿用原生身份重试（%s）",
  async (outcome) => {
    let fail = true;
    const removed = vi.fn((sessionId: string) => {
      if (sessionId !== "native-old") throw new Error("错误的原生删除身份");
      if (fail) throw new acp.RequestError(-32603, "原生删除失败");
      if (outcome === "not-found") throw new acp.RequestError(-32002, "不存在");
      return {};
    });
    const f = await fixture("claude", undefined, undefined, {
      capabilities: { sessionCapabilities: { delete: {} } },
      deleteSession: removed,
    });
    f.tasks.set("t", {
      id: "t",
      provider: "claude",
      projectId: "project",
      sessionId: "native-old",
      cwd: "/workspace",
      title: "历史",
      updatedAt: 1,
      archived: false,
      pinned: false,
      status: "idle",
    });
    await f.history.append("t", oldTurn);
    const events: string[] = [];
    f.provider.subscribeEvents((event) => {
      events.push(event.type);
    });
    await expect(f.provider.deleteTask("t")).rejects.toThrow();
    expect(f.tasks.get("t")?.sessionId).toBe("native-old");
    expect((await f.history.read("t")).turns).toEqual([oldTurn]);
    expect(events).not.toContain("task.removed");
    fail = false;
    await f.provider.deleteTask("t");
    expect(f.tasks.has("t")).toBe(false);
    expect((await f.history.read("t")).turns).toEqual([]);
    expect(events).toEqual(["task.removed"]);
    expect(removed.mock.calls).toEqual([["native-old"], ["native-old"]]);
    expect(f.loaded).not.toHaveBeenCalled();
    expect(f.created).not.toHaveBeenCalled();
  },
);
