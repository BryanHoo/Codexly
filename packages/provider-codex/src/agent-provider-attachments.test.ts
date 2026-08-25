import { describe, expect, it } from "vitest";
import { CodexProtocolMappingError } from "./agent-provider.js";
import { RpcResponseError } from "./jsonl-rpc-client.js";
import {
  FakeRpcClient,
  projectRootPath,
  project,
  createCodexAgentProvider,
  nativeThread,
} from "./agent-provider.test-support.js";

describe("CodexAgentProvider attachments and validation", () => {
  it("maps generated images to assistant attachment metadata without exposing Base64", async () => {
    const imageContent = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const encodedImage = imageContent.toString("base64");
    const rpc = new FakeRpcClient([
      {
        thread: nativeThread({
          turns: [
            {
              completedAt: 1_753_232_400,
              error: null,
              id: "turn-generated-image",
              items: [
                {
                  id: "generated-image-1",
                  failure: null,
                  result: encodedImage,
                  revisedPrompt: "一张架构图",
                  status: "completed",
                  type: "imageGeneration",
                },
              ],
              startedAt: 1_753_228_800,
              status: "completed",
            },
          ],
        }),
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    const snapshot = await provider.readTask("task-1");
    const item = snapshot?.turns[0]?.items[0];
    const attachmentId = item?.type === "message" ? item.attachments?.[0]?.id : undefined;
    if (attachmentId === undefined) {
      throw new Error("Expected generated image attachment metadata");
    }

    expect(item).toEqual({
      attachments: [
        {
          id: attachmentId,
          kind: "image",
          mediaType: "image/png",
          name: "生成图片-1.png",
          size: imageContent.byteLength,
        },
      ],
      id: "generated-image-1",
      role: "assistant",
      text: "",
      type: "message",
    });
    expect(JSON.stringify(snapshot)).not.toContain(encodedImage);
    await expect(provider.readTaskAttachment("task-1", attachmentId)).resolves.toMatchObject({
      content: imageContent,
      mediaType: "image/png",
      name: "生成图片-1.png",
      size: imageContent.byteLength,
    });
  });

  it("maps Codex text elements to attachments instead of exposing pasted content", async () => {
    const attachmentText = "第一行\n你好";
    const attachmentBytes = Buffer.from(attachmentText);
    const rpc = new FakeRpcClient([
      {
        thread: nativeThread({
          turns: [
            {
              completedAt: 1_753_232_400,
              error: null,
              id: "turn-pasted-text",
              items: [
                {
                  content: [
                    { text: "分析附件", type: "text" },
                    {
                      text: attachmentText,
                      text_elements: [
                        {
                          byteRange: { end: attachmentBytes.byteLength, start: 0 },
                          placeholder: "Pasted text.txt",
                        },
                      ],
                      type: "text",
                    },
                  ],
                  id: "message-pasted-text",
                  type: "userMessage",
                },
              ],
              startedAt: 1_753_228_800,
              status: "completed",
            },
          ],
        }),
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    const snapshot = await provider.readTask("task-1");
    const item = snapshot?.turns[0]?.items[0];
    const attachmentId = item?.type === "message" ? item.attachments?.[0]?.id : undefined;
    if (attachmentId === undefined) {
      throw new Error("Expected pasted text attachment metadata");
    }

    expect(item).toEqual({
      attachments: [
        {
          id: attachmentId,
          kind: "text",
          mediaType: "text/plain",
          name: "Pasted text.txt",
          size: attachmentBytes.byteLength,
        },
      ],
      id: "message-pasted-text",
      role: "user",
      text: "分析附件",
      type: "message",
    });
    await expect(provider.readTaskAttachment("task-1", attachmentId)).resolves.toMatchObject({
      content: attachmentBytes,
      mediaType: "text/plain",
      name: "Pasted text.txt",
      size: attachmentBytes.byteLength,
    });
  });

  it("keeps attachment authorization stable across repeated snapshot reads", async () => {
    const imageContent = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const imageUrl = `data:image/png;base64,${imageContent.toString("base64")}`;
    const thread = nativeThread({
      turns: [
        {
          completedAt: 1_753_232_400,
          error: null,
          id: "turn-image",
          items: [
            {
              content: [
                { text: "分析这张图", type: "text" },
                { name: "diagram.png", type: "image", url: imageUrl },
              ],
              id: "message-image",
              type: "userMessage",
            },
          ],
          startedAt: 1_753_228_800,
          status: "completed",
        },
      ],
    });
    const rpc = new FakeRpcClient([{ thread }, { thread }]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    const firstSnapshot = await provider.readTask("task-1");
    const secondSnapshot = await provider.readTask("task-1");
    const firstItem = firstSnapshot?.turns[0]?.items[0];
    const secondItem = secondSnapshot?.turns[0]?.items[0];
    const firstAttachmentId =
      firstItem?.type === "message" ? firstItem.attachments?.[0]?.id : undefined;
    const secondAttachmentId =
      secondItem?.type === "message" ? secondItem.attachments?.[0]?.id : undefined;

    expect(firstAttachmentId).toBeDefined();
    expect(secondAttachmentId).toBe(firstAttachmentId);
    await expect(
      provider.readTaskAttachment("task-1", firstAttachmentId ?? ""),
    ).resolves.toMatchObject({ content: imageContent, mediaType: "image/png" });
  });

  it("preserves failures and bounds command output in task snapshots", async () => {
    const lineLimitedOutput = Array.from(
      { length: 10_001 },
      (_, index) => `line-${String(index)}`,
    ).join("\n");
    const byteLimitedOutput = `开${"界".repeat(400_000)}终`;
    const rpc = new FakeRpcClient([
      {
        thread: nativeThread({
          turns: [
            {
              completedAt: 1_753_232_400,
              error: {
                additionalDetails: null,
                codexErrorInfo: null,
                message: "模型服务不可用",
              },
              id: "failed-turn",
              items: [
                {
                  aggregatedOutput: lineLimitedOutput,
                  command: "print-lines",
                  cwd: "/workspace/Codexly",
                  id: "line-command",
                  status: "failed",
                  type: "commandExecution",
                },
                {
                  aggregatedOutput: byteLimitedOutput,
                  command: "print-bytes",
                  cwd: "/workspace/Codexly",
                  id: "byte-command",
                  status: "completed",
                  type: "commandExecution",
                },
                {
                  arguments: { path: "missing.ts" },
                  error: { message: "MCP 服务不可用" },
                  id: "failed-tool",
                  result: null,
                  server: "filesystem",
                  status: "failed",
                  tool: "read_file",
                  type: "mcpToolCall",
                },
              ],
              startedAt: 1_753_228_800,
              status: "failed",
            },
          ],
        }),
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    const snapshot = await provider.readTask("task-1");
    const turn = snapshot?.turns[0];
    const lineCommand = turn?.items.find((item) => item.id === "line-command");
    const byteCommand = turn?.items.find((item) => item.id === "byte-command");
    const failedTool = turn?.items.find((item) => item.id === "failed-tool");

    expect(turn?.error).toBe("模型服务不可用");
    const retainedLineOutput = [
      ...lineLimitedOutput.split("\n").slice(0, 5_000),
      ...lineLimitedOutput.split("\n").slice(-5_000),
    ].join("\n");
    expect(lineCommand).toMatchObject({
      output: retainedLineOutput,
      outputOmitted: {
        bytes:
          Buffer.byteLength(lineLimitedOutput, "utf8") -
          Buffer.byteLength(retainedLineOutput, "utf8"),
        lines: 1,
      },
    });
    if (byteCommand?.type !== "command") {
      throw new Error("Expected a command item");
    }
    const retainedByteOutput = byteCommand.output ?? "";
    expect(retainedByteOutput.startsWith("开")).toBe(true);
    expect(retainedByteOutput.endsWith("终")).toBe(true);
    expect(retainedByteOutput).not.toContain("�");
    expect(Buffer.byteLength(retainedByteOutput, "utf8")).toBeLessThanOrEqual(1_048_576);
    expect(byteCommand.outputOmitted).toEqual({
      bytes:
        Buffer.byteLength(byteLimitedOutput, "utf8") -
        Buffer.byteLength(retainedByteOutput, "utf8"),
      lines: 0,
    });
    expect(failedTool).toMatchObject({ output: { error: "MCP 服务不可用" } });
  });

  it("returns undefined for another project id even when the thread cwd matches", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread({ cwd: projectRootPath, projectId: "other-project" }) },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.readTask("task-1")).resolves.toBeUndefined();
  });

  it("returns undefined for an unassigned task that was not started locally", async () => {
    const rpc = new FakeRpcClient([{ thread: nativeThread({ projectId: null }) }]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.readTask("task-1")).resolves.toBeUndefined();
  });

  it("returns undefined when Codex reports that a thread is not loaded", async () => {
    const rpc = new FakeRpcClient([
      new RpcResponseError({
        code: -32600,
        data: null,
        message: "thread not loaded: missing-task",
      }),
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.readTask("missing-task")).resolves.toBeUndefined();
  });

  it("reads a newly started task before its first turn is materialized", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      new RpcResponseError({
        code: -32600,
        data: null,
        message:
          "thread task-1 is not materialized yet; includeTurns is unavailable before first user message",
      }),
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await provider.startTask();

    await expect(provider.readTask("task-1")).resolves.toMatchObject({
      contextUsage: null,
      id: "task-1",
      pendingRequests: [],
      projectId: project.id,
      status: "idle",
      turns: [],
    });
  });

  it("keeps ownership when an unmaterialized thread read omits its project id", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      { thread: nativeThread({ projectId: null }) },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await provider.startTask();

    await expect(provider.readTask("task-1")).resolves.toMatchObject({
      contextUsage: null,
      id: "task-1",
      pendingRequests: [],
      projectId: project.id,
      status: "idle",
      turns: [],
      turnsNextCursor: null,
    });
  });

  it("reads a newly started task when paginated turns are not materialized", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread() },
      { thread: nativeThread({ historyMode: "paginated", turns: undefined }) },
      new RpcResponseError({
        code: -32600,
        data: null,
        message:
          "thread task-1 is not materialized yet; thread/turns/list is unavailable before first user message",
      }),
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await provider.startTask();

    await expect(provider.readTask("task-1")).resolves.toMatchObject({
      contextUsage: null,
      id: "task-1",
      pendingRequests: [],
      projectId: project.id,
      status: "idle",
      turns: [],
      turnsNextCursor: null,
    });
    expect(rpc.calls.slice(-3)).toEqual([
      {
        method: "thread/read",
        params: { includeTurns: false, threadId: "task-1" },
      },
      { method: "thread/goal/get", params: { threadId: "task-1" } },
      {
        method: "thread/turns/list",
        params: {
          itemsView: "notLoaded",
          limit: 10,
          sortDirection: "desc",
          threadId: "task-1",
        },
      },
    ]);
  });

  it("preserves paginated materialization failures for tasks not started locally", async () => {
    const error = new RpcResponseError({
      code: -32600,
      data: null,
      message:
        "thread task-1 is not materialized yet; thread/turns/list is unavailable before first user message",
    });
    const rpc = new FakeRpcClient([
      { thread: nativeThread({ historyMode: "paginated", turns: undefined }) },
      error,
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.readTask("task-1")).rejects.toBe(error);
  });

  it("preserves unrelated RPC failures when reading a thread", async () => {
    const error = new RpcResponseError({
      code: -32600,
      data: null,
      message: "invalid request",
    });
    const rpc = new FakeRpcClient([error]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.readTask("task-1")).rejects.toBe(error);
  });

  it("rejects malformed native responses at the adapter boundary", async () => {
    const rpc = new FakeRpcClient([{ data: "invalid" }]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.listTasks()).rejects.toThrow(CodexProtocolMappingError);
  });
});
