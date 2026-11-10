import { expect, it } from "vitest";
import type { SessionConfigOption } from "@agentclientprotocol/sdk/unstable";
import { AcpSessionMetadataStore } from "./session-metadata.js";

const model: SessionConfigOption = {
  id: "model",
  name: "模型",
  type: "select",
  currentValue: "a",
  options: [{ value: "a", name: "A" }],
};

it("命令可先于会话绑定到达，配置响应保留命令，状态按session隔离且返回副本", () => {
  const store = new AcpSessionMetadataStore();
  const commands = [{ name: "review", description: "检查", input: { hint: "范围" } }];
  store.update({
    sessionId: "s",
    update: { sessionUpdate: "available_commands_update", availableCommands: commands },
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
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "token" } },
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
