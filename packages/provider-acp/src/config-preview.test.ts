import { expect, it, vi } from "vitest";
import { previewAcpConfig } from "./config-preview.js";

it("预览使用项目目录，关闭临时会话且不提供持久写入端口", async () => {
  const options = [
    {
      id: "model",
      name: "模型",
      type: "select",
      category: "model",
      currentValue: "a",
      options: [
        { value: "a", name: "A" },
        { value: "b", name: "B" },
      ],
    },
  ];
  const connection = {
    initialization: { capabilities: { session: { close: true } } },
    newSession: vi.fn(() => Promise.resolve({ sessionId: "preview", configOptions: options })),
    setConfigOption: vi.fn(() =>
      Promise.resolve({ configOptions: [{ ...options[0], currentValue: "b" }] }),
    ),
    closeSession: vi.fn(() => Promise.resolve({})),
  };
  const saved = { configured: true, values: { model: "a" } };
  const result = await previewAcpConfig(connection as never, "/project", saved as never, {
    model: "b",
  });
  expect(result.configOptions[0]?.currentValue).toBe("b");
  expect(connection.newSession).toHaveBeenCalledWith({ cwd: "/project", mcpServers: [] });
  expect(connection.closeSession).toHaveBeenCalledWith("preview");
  expect(saved.values).toEqual({ model: "a" });
});
it("配置拒绝时仍关闭预览会话", async () => {
  const closeSession = vi.fn(() => Promise.resolve({}));
  const connection = {
    initialization: { capabilities: { session: { close: true } } },
    newSession: vi.fn(() => Promise.resolve({ sessionId: "preview", configOptions: [] })),
    closeSession,
  };
  await expect(
    previewAcpConfig(connection as never, "/p", { configured: true, values: {} } as never, {
      unknown: true,
    }),
  ).rejects.toThrow();
  expect(closeSession).toHaveBeenCalledOnce();
});

it("模型切换丢弃旧依赖值并返回可交付首发的完整当前值", async () => {
  const model = {
    id: "model",
    name: "模型",
    type: "select",
    category: "model",
    currentValue: "a",
    options: [
      { value: "a", name: "A" },
      { value: "b", name: "B" },
    ],
  };
  const effort = {
    id: "effort",
    name: "思考",
    type: "select",
    currentValue: "low",
    options: [{ value: "low", name: "低" }],
  };
  const connection = {
    initialization: { capabilities: { session: { close: true } } },
    newSession: vi.fn(() => Promise.resolve({ sessionId: "p", configOptions: [model, effort] })),
    setConfigOption: vi.fn(() =>
      Promise.resolve({ configOptions: [{ ...model, currentValue: "b" }] }),
    ),
    closeSession: vi.fn(() => Promise.resolve({})),
  };
  const result = await previewAcpConfig(
    connection as never,
    "/project",
    { configured: true, values: {} } as never,
    { model: "a", effort: "low" },
    { configId: "model", value: "b" },
  );
  expect(result.values).toEqual({ model: "b" });
  expect(connection.setConfigOption).toHaveBeenCalledExactlyOnceWith("p", "model", "b");
});
it("预览支持宿主提供的临时会话释放回调", async () => {
  const release = vi.fn(() => Promise.resolve());
  const connection = {
    initialization: { capabilities: {} },
    newSession: vi.fn(() => Promise.resolve({ sessionId: "standard", configOptions: [] })),
  };
  await expect(
    previewAcpConfig(
      connection as never,
      "/p",
      { configured: true, values: {} } as never,
      {},
      undefined,
      release,
    ),
  ).resolves.toEqual({ configOptions: [], values: {} });
  expect(release).toHaveBeenCalledExactlyOnceWith("standard");
});
