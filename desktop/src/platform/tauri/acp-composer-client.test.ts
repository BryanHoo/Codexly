import { expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string, protocol: string) => `${protocol}://${path}`,
}));
import { createAcpComposerQueueClient } from "./acp-composer-client.js";

it("原生输入队列只调用 ACP 端口并保留身份、等待取消和附件授权标记", async () => {
  const result = {
    data: [],
    queue: { data: [] },
    queuedSubmission: {
      id: "q",
      status: "queued",
      text: "",
      attachments: [],
      skills: [],
      clientUserMessageId: "m",
    },
    turn: {
      id: "turn",
      status: "running",
      items: [],
      startedAt: null,
      completedAt: null,
      error: null,
    },
  };
  const client = {
    listAcpQueuedSubmissions: vi.fn(async () => result),
    addAcpQueuedSubmission: vi.fn(async () => result),
    deleteAcpQueuedSubmission: vi.fn(async () => result),
    moveAcpQueuedSubmission: vi.fn(async () => result),
    startAcpQueuedSubmission: vi.fn(async () => result),
    listQueuedSubmissions: vi.fn(),
  };
  const port = createAcpComposerQueueClient(client as never);
  const input = { type: "prompt" as const, text: "继续", attachments: [], skills: [] };
  const options = { idempotencyKey: "key", signal: new AbortController().signal };
  expect(await port.listQueuedSubmissions("p", "t", options)).toEqual({ data: [] });
  await port.addQueuedSubmission("p", "t", input, "message", options);
  await port.deleteQueuedSubmission("p", "t", "q", options);
  await port.moveQueuedSubmission("p", "t", "q", -1, options);
  await port.startQueuedSubmission("p", "t", "q", options);
  expect(client.listAcpQueuedSubmissions).toHaveBeenCalledWith("p", "t", options);
  expect(client.addAcpQueuedSubmission).toHaveBeenCalledWith("p", "t", input, "message", options);
  expect(client.deleteAcpQueuedSubmission).toHaveBeenCalledWith("p", "t", "q", options);
  expect(client.moveAcpQueuedSubmission).toHaveBeenCalledWith("p", "t", "q", -1, options);
  expect(client.startAcpQueuedSubmission).toHaveBeenCalledWith("p", "t", "q", options);
  expect(port.getTaskAttachmentUrl("p", "t", "history-file")).toContain("acp=1");
  expect(client.listQueuedSubmissions).not.toHaveBeenCalled();
});

it("缺少 ACP 队列端口明确拒绝，不回退旧引擎", () => {
  const legacy = vi.fn();
  const port = createAcpComposerQueueClient({ listQueuedSubmissions: legacy } as never);
  expect(() => port.listQueuedSubmissions("p", "t")).toThrow("ACP");
  expect(legacy).not.toHaveBeenCalled();
});

it("ACP 队列隐藏正在编辑的条目", async () => {
  const base = { id: "q", text: "继续", skills: [], attachments: [], clientUserMessageId: "m" };
  const port = createAcpComposerQueueClient({
    listAcpQueuedSubmissions: async () => ({
      data: [
        { ...base, status: "editing" },
        { ...base, id: "ready", status: "queued" },
      ],
    }),
  } as never);
  expect((await port.listQueuedSubmissions("p", "t")).data.map((item) => item.id)).toEqual([
    "ready",
  ]);
});
