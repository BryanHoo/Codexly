import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FakeRpcClient,
  project,
  PINNED_THREAD_SECTION,
  createCodexAgentProvider,
  nativeThread,
} from "./agent-provider.test-support.js";

describe("CodexAgentProvider snapshots", () => {
  it("maps thread/list without repeating the runtime handshake", async () => {
    const rpc = new FakeRpcClient([
      { data: [nativeThread({ section: PINNED_THREAD_SECTION })], nextCursor: "next-cursor" },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.getCapabilities()).resolves.toEqual({
      feedback: { upload: true },
      goals: { clear: true, read: true, update: true },
      provider: "codex",
      skills: { list: true, use: true },
      tasks: { fork: true, list: true, read: true, start: true },
      turns: {
        compact: true,
        interrupt: true,
        review: true,
        start: true,
        steer: true,
      },
    });
    await expect(
      provider.listTasks({ cursor: "cursor", limit: 25, pinnedOnly: true }),
    ).resolves.toEqual({
      data: [
        {
          id: "task-1",
          pinned: true,
          projectId: "codexly",
          threadConfiguration: { model: null, reasoningEffort: null },
          title: "实现真实 Task 历史",
          updatedAt: "2025-07-23T01:00:00.000Z",
        },
      ],
      nextCursor: "next-cursor",
    });
    expect(rpc.calls).toEqual([
      {
        method: "thread/list",
        params: {
          cursor: "cursor",
          limit: 25,
          projectId: project.id,
          sectionId: PINNED_THREAD_SECTION.id,
          sortDirection: "desc",
          sortKey: "updated_at",
        },
      },
    ]);
    expect(rpc.notifications).toEqual([]);
  });

  it("passes archived task pagination and title search to Codex", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: "archived-next" }]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(
      provider.listTasks({
        archived: true,
        cursor: "archived-cursor",
        limit: 20,
        searchTerm: "归档",
      }),
    ).resolves.toMatchObject({ nextCursor: "archived-next" });
    expect(rpc.calls).toEqual([
      {
        method: "thread/list",
        params: {
          archived: true,
          cursor: "archived-cursor",
          limit: 20,
          projectId: project.id,
          searchTerm: "归档",
          sortDirection: "desc",
          sortKey: "updated_at",
        },
      },
    ]);
  });

  it("fills a completed task page across active native threads", async () => {
    const rpc = new FakeRpcClient([
      {
        data: [nativeThread({ id: "task-running", status: { activeFlags: [], type: "active" } })],
        nextCursor: "completed-next",
      },
      {
        data: [nativeThread({ id: "task-completed", status: { type: "notLoaded" } })],
        nextCursor: null,
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.listTasks({ completed: true, limit: 1 })).resolves.toMatchObject({
      data: [{ id: "task-completed" }],
      nextCursor: null,
    });
    expect(rpc.calls).toEqual([
      {
        method: "thread/list",
        params: {
          limit: 1,
          projectId: project.id,
          sortDirection: "desc",
          sortKey: "updated_at",
        },
      },
      {
        method: "thread/list",
        params: {
          cursor: "completed-next",
          limit: 1,
          projectId: project.id,
          sortDirection: "desc",
          sortKey: "updated_at",
        },
      },
    ]);
  });

  it("does not treat a custom Codex section as pinned", async () => {
    const rpc = new FakeRpcClient([
      {
        data: [
          nativeThread({
            section: {
              appearance: { color: "blue", icon: "clock" },
              id: "01984de2-8f74-7c91-a3b2-5c5e937cf999",
              name: "Later",
            },
          }),
        ],
        nextCursor: null,
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.listTasks()).resolves.toMatchObject({
      data: [{ id: "task-1", pinned: false }],
    });
  });

  it("rejects thread sections without the 0.153.4 appearance field", async () => {
    const rpc = new FakeRpcClient([
      {
        data: [
          nativeThread({
            section: { id: PINNED_THREAD_SECTION.id, name: PINNED_THREAD_SECTION.name },
          }),
        ],
        nextCursor: null,
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.listTasks()).rejects.toThrow(
      "Codex thread section appearance is invalid",
    );
  });

  it("maps thread/read turns and items without exposing native thread fields", async () => {
    const rpc = new FakeRpcClient([
      {
        thread: nativeThread({
          name: "结构化历史",
          status: { activeFlags: [], type: "active" },
          turns: [
            {
              completedAt: 1_753_232_400,
              id: "turn-1",
              items: [
                {
                  content: [
                    {
                      text: "$review-security",
                      type: "text",
                    },
                  ],
                  id: "i1",
                  type: "userMessage",
                },
                {
                  content: [
                    {
                      text: [
                        "<skill>",
                        "<name>review-security</name>",
                        "<path>/Users/test/.codex/skills/review-security/SKILL.md</path>",
                        "---",
                        "name: review-security",
                        "description: Security audit specialist",
                        "---",
                        "Review authentication boundaries.",
                        "</skill>",
                      ].join("\n"),
                      type: "text",
                    },
                  ],
                  id: "i1-skill",
                  type: "userMessage",
                },
                { delivery: null, questions: null, id: "i2", text: "已读取", type: "agentMessage" },
                {
                  content: ["核对边界"],
                  id: "i3",
                  summary: ["分析协议"],
                  type: "reasoning",
                },
                {
                  aggregatedOutput: "Done",
                  command: "pnpm check",
                  commandActions: [],
                  cwd: "/workspace/Codexly",
                  exitCode: 0,
                  id: "i4",
                  status: "completed",
                  type: "commandExecution",
                },
                {
                  changes: [
                    {
                      diff: "+export {};",
                      kind: { move_path: null, type: "update" },
                      path: "src/index.ts",
                    },
                  ],
                  id: "i5",
                  status: "completed",
                  type: "fileChange",
                },
                {
                  arguments: { path: "src/index.ts" },
                  id: "i6",
                  result: { content: [{ text: "export {};", type: "text" }] },
                  server: "filesystem",
                  status: "completed",
                  tool: "read_file",
                  type: "mcpToolCall",
                },
                {
                  id: "i6-output",
                  name: "read_file",
                  namespace: "filesystem",
                  output: [{ text: "export {};", type: "input_text" }],
                  type: "functionCallOutput",
                },
                { id: "i7", text: "1. 定义协议", type: "plan" },
                { id: "i8", type: "contextCompaction" },
                { id: "i9", type: "futureItem", value: "private" },
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

    expect(rpc.calls[0]).toEqual({
      method: "thread/read",
      params: { includeTurns: false, threadId: "task-1" },
    });
    expect(snapshot).toMatchObject({
      id: "task-1",
      projectId: "codexly",
      status: "running",
      title: "结构化历史",
      turns: [
        {
          error: null,
          id: "turn-1",
          status: "completed",
          items: [
            {
              id: "i1",
              role: "user",
              skills: [{ name: "review-security" }],
              text: "",
              type: "message",
            },
            { id: "i2", role: "assistant", text: "已读取", type: "message" },
            { content: "核对边界", id: "i3", summary: "分析协议", type: "reasoning" },
            {
              command: "pnpm check",
              cwd: "/workspace/Codexly",
              exitCode: 0,
              id: "i4",
              output: "Done",
              outputOmitted: { bytes: 0, lines: 0 },
              status: "completed",
              type: "command",
            },
            {
              changes: [{ diff: "+export {};", kind: "update", path: "src/index.ts" }],
              id: "i5",
              status: "completed",
              type: "file_change",
            },
            {
              id: "i6",
              input: { path: "src/index.ts" },
              name: "filesystem/read_file",
              output: { content: [{ text: "export {};", type: "text" }] },
              status: "completed",
              type: "tool",
            },
            {
              id: "i6-output",
              name: "filesystem/read_file",
              output: [{ text: "export {};", type: "input_text" }],
              status: "completed",
              type: "tool",
            },
            { id: "i7", text: "1. 定义协议", type: "plan" },
            { id: "i8", label: "上下文压缩", transient: true, type: "activity" },
            {
              detail: "未识别的活动类型: futureItem",
              id: "i9",
              label: "Provider 活动",
              type: "activity",
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /modelProvider|sessionId|nativeThread|futureItem.*private/,
    );
  });

  it("maps Codex local images to metadata and reads their bytes on demand", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "codexly-image-"));
    const imagePath = join(temporaryDirectory, "diagram.png");
    const imageContent = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    writeFileSync(imagePath, imageContent);
    const rpc = new FakeRpcClient([
      {
        thread: nativeThread({
          turns: [
            {
              completedAt: 1_753_232_400,
              error: null,
              id: "turn-image",
              items: [
                {
                  content: [
                    { text: "分析这张图", type: "text" },
                    { path: imagePath, type: "localImage" },
                  ],
                  id: "message-image",
                  type: "userMessage",
                },
              ],
              startedAt: 1_753_228_800,
              status: "completed",
            },
          ],
        }),
      },
      { data: [], nextCursor: null },
      { status: "unsubscribed" },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    try {
      const snapshot = await provider.readTask("task-1");
      const item = snapshot?.turns[0]?.items[0];
      const attachmentId = item?.type === "message" ? item.attachments?.[0]?.id : undefined;
      if (attachmentId === undefined) {
        throw new Error("Expected historical attachment metadata");
      }

      expect(item).toEqual({
        attachments: [
          {
            id: attachmentId,
            kind: "image",
            mediaType: "image/png",
            name: "diagram.png",
            size: imageContent.byteLength,
          },
        ],
        id: "message-image",
        role: "user",
        text: "分析这张图",
        type: "message",
      });
      expect(attachmentId).not.toHaveLength(0);
      expect(JSON.stringify(snapshot)).not.toContain(imagePath);
      expect(JSON.stringify(snapshot)).not.toContain("data:image");
      await expect(provider.readTaskAttachment("task-1", attachmentId)).resolves.toMatchObject({
        content: imageContent,
        mediaType: "image/png",
        name: "diagram.png",
        size: imageContent.byteLength,
      });
      await expect(provider.unsubscribeTask("task-1")).resolves.toBe("unsubscribed");
      await expect(provider.readTaskAttachment("task-1", attachmentId)).resolves.toBeUndefined();
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
