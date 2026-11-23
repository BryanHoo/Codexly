import { expect, it } from "vitest";
import type { AcpConfigOption as SessionConfigOption } from "@codexly/protocol";
import { AcpSessionMetadataStore } from "./session-metadata.js";

const model: SessionConfigOption = {
  id: "model",
  name: "模型",
  type: "select",
  currentValue: "a",
  options: [{ value: "a", name: "A" }],
};

it("按会话合并标题和活动时间，保留省略值并允许显式清空", () => {
  const store = new AcpSessionMetadataStore();
  const update = (fields: { title?: string | null; updatedAt?: string | null }) =>
    store.update({ sessionId: "s", update: { sessionUpdate: "session_info_update", ...fields } });
  expect(update({ title: "Agent 标题" })).toMatchObject({ title: "Agent 标题" });
  store.configure("s", [model]);
  const updatedAt = "2026-11-23T00:00:00Z";
  expect(update({ updatedAt })).toMatchObject({ title: "Agent 标题", updatedAt });
  expect(update({ updatedAt })).toBeUndefined();
  expect(update({ title: null })).toMatchObject({ title: null, updatedAt, configOptions: [model] });
  expect(store.read("other")).not.toHaveProperty("title");
});

it("会话用量独立隔离、覆盖最新值并随元数据清理，配置更新不丢失用量", () => {
  const store = new AcpSessionMetadataStore();
  const update = (sessionId: string, used: number) =>
    store.update({
      sessionId,
      update: { sessionUpdate: "usage_update", used, size: 200000 },
    });
  expect(update("s", 53000)).toBeUndefined();
  update("other", 1000);
  store.configure("s", [model]);
  const snapshot = store.readUsage("s");
  expect(snapshot).toEqual({ usedTokens: 53000, contextWindow: 200000 });
  if (!snapshot) throw new Error("用量缺失");
  Object.assign(snapshot, { usedTokens: 99 });
  expect(store.readUsage("s")?.usedTokens).toBe(53000);
  update("s", 12000);
  expect(store.readUsage("s")?.usedTokens).toBe(12000);
  update("s", 0);
  expect(store.readUsage("s")?.usedTokens).toBe(0);
  expect(store.readUsage("other")?.usedTokens).toBe(1000);
  store.retain(new Set(["s"]));
  expect(store.readUsage("other")).toBeNull();
  store.delete("s");
  expect(store.readUsage("s")).toBeNull();
  for (let index = 0; index < 128; index++) update(`s-${String(index)}`, index);
  expect(() => update("overflow", 1)).toThrow("容量");
  store.clear();
  expect(store.readUsage("s-0")).toBeNull();
});

it("命令可先于会话绑定到达，配置响应保留命令，状态按session隔离且返回副本", () => {
  const store = new AcpSessionMetadataStore();
  const commands = [{ name: "review", description: "检查", input: { hint: "范围" } }];
  store.update({
    sessionId: "s",
    update: {
      sessionUpdate: "available_commands_update",
      availableCommands: commands.map((command) => ({
        ...command,
        type: "command",
        input: { ...command.input, type: "text" },
      })),
    },
  });
  store.configure("s", [model]);
  const state = store.read("s");
  expect(state.availableCommands).toEqual(commands);
  expect(state.configOptions).toEqual([model]);
  const command = commands[0],
    option = state.configOptions[0];
  if (!command || !option) throw new Error("缺少元数据夹具");
  command.name = "changed";
  option.currentValue = "other";
  expect(store.read("s").availableCommands[0]?.name).toBe("review");
  expect(store.read("s").configOptions[0]?.currentValue).toBe("a");
  expect(store.read("other")).toEqual({ configOptions: [], availableCommands: [] });
  expect(store.configure("s", [model])).toBeUndefined();
});

it("聊天token不占元数据容量，未绑定缓存有界并可清理", () => {
  const store = new AcpSessionMetadataStore();
  for (let index = 0; index < 256; index++) {
    expect(
      store.update({
        sessionId: `text-${String(index)}`,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "test-message",
          content: { type: "text", text: "token" },
        },
      }),
    ).toBeUndefined();
  }
  for (let index = 0; index < 128; index++) store.configure(`s-${String(index)}`, []);
  expect(() => store.configure("overflow", [])).toThrow("容量");
  store.retain(new Set(["s-0"]));
  expect(store.configure("new", [model])).toMatchObject({ configOptions: [model] });
  store.delete("new");
  expect(store.read("new").configOptions).toEqual([]);
  store.clear();
  expect(store.read("s-0").configOptions).toEqual([]);
});

it("元数据有单会话及总字节预算，超限不会覆盖上次有效状态", () => {
  const store = new AcpSessionMetadataStore();
  store.configure("s", [model]);
  expect(() => store.configure("s", [{ ...model, name: "大".repeat(100_000) }])).toThrow("预算");
  expect(store.read("s").configOptions).toEqual([model]);
  const large = [{ ...model, name: "x".repeat(240_000) }];
  for (let index = 0; index < 17; index++) store.configure(`large-${String(index)}`, large);
  expect(() => store.configure("too-many", large)).toThrow("预算");
});
