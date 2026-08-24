import type { AgentEvent, AgentTaskSnapshotResponse } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";

import { AgentEventBuffer, mergeSubmittedPromptIntoSnapshot } from "./task-runtime.js";

const snapshot: AgentTaskSnapshotResponse["snapshot"] = {
  contextUsage: null,
  plan: null,
  id: "task-1",
  pendingRequests: [],
  pinned: false,
  projectId: "codexly",
  settings: {
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    sandboxMode: "workspace-write",
  },
  status: "running",
  title: "实时链路",
  turns: [],
  turnsNextCursor: null,
  updatedAt: "2026-07-23T00:00:00.000Z",
};

function delta(sequence: number, value: string, itemId = "message-1"): AgentEvent {
  return {
    itemId,
    payload: { delta: value },
    provider: "codex",
    sequence,
    sessionId: "runtime-1",
    taskId: "task-1",
    timestamp: "2026-07-23T00:00:01.000Z",
    turnId: "turn-1",
    type: "message.delta",
    version: 2,
  };
}

describe("submitted prompt merge", () => {
  it("keeps a submitted skill prompt visible until the authoritative user item arrives", () => {
    const submittedTurn = {
      completedAt: null,
      error: null,
      id: "turn-1",
      items: [],
      startedAt: snapshot.updatedAt,
      status: "running" as const,
    };
    const mergedSnapshot = mergeSubmittedPromptIntoSnapshot(
      { ...snapshot, turns: [submittedTurn] },
      submittedTurn,
      {
        attachments: [],
        skills: [
          { id: "skill-1", name: "frontend-design" },
          { id: "skill-2", name: "documentation-writer" },
        ],
        text: "检查输入框交互",
      },
    );

    expect(mergedSnapshot.turns[0]?.items).toEqual([
      {
        id: "submitted-user-turn-1",
        role: "user",
        skills: [{ name: "frontend-design" }, { name: "documentation-writer" }],
        text: "检查输入框交互",
        type: "message",
      },
    ]);
  });

  it("removes duplicated skill reference text from the submitted turn", () => {
    const submittedTurn = {
      completedAt: null,
      error: null,
      id: "turn-skill-only",
      items: [
        {
          id: "provider-user-skill-only",
          role: "user" as const,
          skills: [{ name: "superwork:superwork-init" }],
          text: "$superwork:superwork-init",
          type: "message" as const,
        },
      ],
      startedAt: snapshot.updatedAt,
      status: "running" as const,
    };

    const mergedSnapshot = mergeSubmittedPromptIntoSnapshot(
      { ...snapshot, turns: [submittedTurn] },
      submittedTurn,
      {
        attachments: [],
        skills: [{ id: "skill-superwork-init", name: "superwork:superwork-init" }],
        text: "",
      },
    );

    expect(mergedSnapshot.turns[0]?.items).toEqual([
      {
        id: "provider-user-skill-only",
        role: "user",
        skills: [{ name: "superwork:superwork-init" }],
        text: "",
        type: "message",
      },
    ]);
  });

  it("uses the provider image item for an image-only submitted turn", () => {
    const submittedTurn = {
      completedAt: null,
      error: null,
      id: "turn-image",
      items: [
        {
          attachments: [
            {
              id: "history-image-1",
              kind: "image" as const,
              mediaType: "image/png" as const,
              name: "diagram.png",
              size: 68,
            },
          ],
          id: "provider-user-image",
          role: "user" as const,
          text: "",
          type: "message" as const,
        },
      ],
      startedAt: snapshot.updatedAt,
      status: "running" as const,
    };
    const mergedSnapshot = mergeSubmittedPromptIntoSnapshot(
      { ...snapshot, turns: [{ ...submittedTurn, items: [] }] },
      submittedTurn,
      { attachments: [{ id: "attachment-1" }], skills: [], text: "" },
    );

    expect(mergedSnapshot.turns[0]?.items).toEqual(submittedTurn.items);
  });

  it("keeps submitted attachment metadata visible before the provider user item arrives", () => {
    const submittedTurn = {
      completedAt: null,
      error: null,
      id: "turn-pasted-text",
      items: [],
      startedAt: snapshot.updatedAt,
      status: "running" as const,
    };
    const mergedSnapshot = mergeSubmittedPromptIntoSnapshot(
      { ...snapshot, turns: [submittedTurn] },
      submittedTurn,
      {
        attachments: [{ id: "attachment-pasted-text" }],
        messageAttachments: [
          {
            id: "attachment-pasted-text",
            kind: "text",
            mediaType: "text/plain",
            name: "Pasted text.txt",
            size: 1_001,
          },
        ],
        skills: [],
        text: "",
      },
    );

    expect(mergedSnapshot.turns[0]?.items).toEqual([
      {
        attachments: [
          {
            id: "attachment-pasted-text",
            kind: "text",
            mediaType: "text/plain",
            name: "Pasted text.txt",
            size: 1_001,
          },
        ],
        id: "submitted-user-turn-pasted-text",
        role: "user",
        text: "",
        type: "message",
      },
    ]);
  });

  it("enriches an empty runtime user item with submitted attachment metadata", () => {
    const submittedTurn = {
      completedAt: null,
      error: null,
      id: "turn-runtime-placeholder",
      items: [],
      startedAt: snapshot.updatedAt,
      status: "running" as const,
    };
    const runtimeTurn = {
      ...submittedTurn,
      items: [
        {
          id: "runtime-user-placeholder",
          role: "user" as const,
          text: "x".repeat(1_001),
          type: "message" as const,
        },
      ],
    };
    const messageAttachments = [
      {
        id: "attachment-pasted-text",
        kind: "text" as const,
        mediaType: "text/plain",
        name: "Pasted text.txt",
        size: 1_001,
      },
    ];

    const mergedSnapshot = mergeSubmittedPromptIntoSnapshot(
      { ...snapshot, turns: [runtimeTurn] },
      submittedTurn,
      {
        attachments: [{ id: "attachment-pasted-text" }],
        messageAttachments,
        skills: [],
        text: "",
      },
    );

    expect(mergedSnapshot.turns[0]?.items[0]).toEqual({
      attachments: messageAttachments,
      id: "runtime-user-placeholder",
      role: "user",
      text: "",
      type: "message",
    });
  });
});

describe("AgentEventBuffer", () => {
  it("merges only adjacent deltas with the same item key", () => {
    const buffer = new AgentEventBuffer();

    buffer.push(delta(1, "流"));
    buffer.push(delta(2, "式"));
    buffer.push(delta(3, "旁路", "message-2"));
    buffer.push(delta(4, "更新"));

    expect(buffer.drain()).toMatchObject([
      { payload: { delta: "流式" }, sequence: 2 },
      { itemId: "message-2", payload: { delta: "旁路" }, sequence: 3 },
      { payload: { delta: "更新" }, sequence: 4 },
    ]);
  });

  it("flushes only deltas earlier than a terminal sequence", () => {
    const buffer = new AgentEventBuffer();
    buffer.push(delta(1, "一"));
    buffer.push(delta(3, "三", "message-2"));

    expect(buffer.flushThrough(3)).toMatchObject([{ sequence: 1 }]);
    expect(buffer.drain()).toMatchObject([{ sequence: 3 }]);
  });

  it("reuses cached UTF-8 byte lengths while flushing", () => {
    const buffer = new AgentEventBuffer({ maxBytes: 6 });
    const encodeSpy = vi.spyOn(TextEncoder.prototype, "encode");

    try {
      expect(buffer.push(delta(1, "你"))).toBe(true);
      expect(buffer.push(delta(2, "好"))).toBe(true);
      expect(encodeSpy).toHaveBeenCalledTimes(2);

      expect(buffer.drain()).toMatchObject([{ payload: { delta: "你好" } }]);
      expect(encodeSpy).toHaveBeenCalledTimes(2);
      expect(buffer.push(delta(3, "！"))).toBe(true);
    } finally {
      encodeSpy.mockRestore();
    }
  });

  it("drops buffered deltas after bounded capacity is exceeded", () => {
    const buffer = new AgentEventBuffer({ maxBytes: 4, maxEvents: 2 });

    expect(buffer.push(delta(1, "1234"))).toBe(true);
    expect(buffer.push(delta(2, "5", "message-2"))).toBe(false);
    expect(buffer.drain()).toEqual([]);
  });
});
