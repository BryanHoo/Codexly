import { Buffer } from "node:buffer";
import { MAX_REALTIME_DIFF_BYTES, MAX_REALTIME_FILE_CHANGES } from "@codexly/protocol";
import { describe, expect, it } from "vitest";
import { mapAgentTurn } from "./codex-protocol-mapping.js";
import { mapNotification } from "./codex-protocol-mapping.test-support.js";
import { boundRealtimeDiff, mapCodexFileChange } from "./codex-diff-mapping.js";

describe("Codex realtime protocol mapping", () => {
  it("removes repeated copied skill references when merging expanded skill history", () => {
    const turn = mapAgentTurn(
      {
        completedAt: 1_753_232_400,
        id: "turn-copied-skill",
        items: [
          {
            content: [
              {
                text: "$superwork:superwork-start $superwork:superwork-start 根据项目需求继续实现。",
                type: "text",
              },
            ],
            id: "user-copied-skill",
            type: "userMessage",
          },
          {
            content: [
              {
                text: [
                  "<skill>",
                  "<name>superwork:superwork-start</name>",
                  "<path>/Users/test/.codex/skills/superwork-start/SKILL.md</path>",
                  "执行 Superwork 流程。",
                  "</skill>",
                ].join("\n"),
                type: "text",
              },
            ],
            id: "expanded-copied-skill",
            type: "userMessage",
          },
        ],
        startedAt: 1_753_228_800,
        status: "completed",
      },
      () => undefined,
      () => undefined,
    );

    expect(turn.items).toContainEqual({
      id: "user-copied-skill",
      role: "user",
      skills: [{ name: "superwork:superwork-start" }],
      text: "根据项目需求继续实现。",
      type: "message",
    });
  });

  it("maps streaming plan, tool, file, and reasoning notifications", () => {
    expect(
      mapNotification("item/plan/delta", {
        delta: "## 计划",
        itemId: "plan-1",
        threadId: "task-1",
        turnId: "turn-1",
      }),
    ).toMatchObject({ itemId: "plan-1", payload: { delta: "## 计划" }, type: "plan.delta" });
    expect(
      mapNotification("item/mcpToolCall/progress", {
        itemId: "mcp-1",
        message: "正在读取资源",
        threadId: "task-1",
        turnId: "turn-1",
      }),
    ).toMatchObject({ payload: { message: "正在读取资源" }, type: "tool.progress" });
    expect(
      mapNotification("item/fileChange/patchUpdated", {
        changes: [{ diff: "+const ready = true;", kind: { type: "update" }, path: "src/app.ts" }],
        itemId: "patch-1",
        threadId: "task-1",
        turnId: "turn-1",
      }),
    ).toMatchObject({
      payload: {
        changes: [{ diff: "+const ready = true;", kind: "update", path: "src/app.ts" }],
        originalByteLength: 20,
        truncated: false,
      },
      type: "file_change.updated",
    });
    expect(
      mapNotification("item/fileChange/patchUpdated", {
        changes: [{ diff: "first\n-second", kind: { type: "add" }, path: "src/new.ts" }],
        itemId: "patch-create",
        threadId: "task-1",
        turnId: "turn-1",
      }),
    ).toMatchObject({
      payload: {
        changes: [
          {
            diff: "--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1,2 @@\n+first\n+-second",
            kind: "create",
          },
        ],
      },
      type: "file_change.updated",
    });
    expect(
      mapNotification("item/reasoning/summaryPartAdded", {
        itemId: "reasoning-1",
        summaryIndex: 2,
        threadId: "task-1",
        turnId: "turn-1",
      }),
    ).toMatchObject({
      payload: { delta: "", field: "summary", sectionIndex: 2 },
      type: "reasoning.delta",
    });
  });

  it("normalizes completed Codex file items with the same diff contract", () => {
    const turn = mapAgentTurn(
      {
        completedAt: 1_753_232_400,
        id: "turn-file-create",
        items: [
          {
            changes: [
              {
                diff: "--- guide\n+++ example\n@@ literal",
                kind: { type: "add" },
                path: "docs/new.md",
              },
            ],
            id: "file-create",
            status: "completed",
            type: "fileChange",
          },
        ],
        startedAt: 1_753_228_800,
        status: "completed",
      },
      () => undefined,
      () => undefined,
    );

    expect(turn.items[0]).toMatchObject({
      changes: [
        {
          diff: "--- /dev/null\n+++ b/docs/new.md\n@@ -0,0 +1,3 @@\n+--- guide\n++++ example\n+@@ literal",
          kind: "create",
        },
      ],
      type: "file_change",
    });
  });

  it("bounds realtime file patches by aggregate UTF-8 bytes and change count", () => {
    const leadingDiff = "a".repeat(MAX_REALTIME_DIFF_BYTES - 1);
    const nativeChanges = [
      { diff: leadingDiff, kind: { type: "update" }, path: "src/first.ts" },
      { diff: "汉字", kind: { type: "add" }, path: "src/second.ts" },
      ...Array.from({ length: MAX_REALTIME_FILE_CHANGES - 1 }, (_, index) => ({
        diff: "+x",
        kind: { type: "update" },
        path: `src/extra-${String(index)}.ts`,
      })),
    ];

    const event = mapNotification("item/fileChange/patchUpdated", {
      changes: nativeChanges,
      itemId: "patch-large",
      threadId: "task-1",
      turnId: "turn-1",
    });

    expect(event?.type).toBe("file_change.updated");
    if (event?.type !== "file_change.updated") return;
    expect(event.payload.changes).toHaveLength(MAX_REALTIME_FILE_CHANGES);
    expect(
      event.payload.changes.reduce(
        (bytes, change) => bytes + Buffer.byteLength(change.diff, "utf8"),
        0,
      ),
    ).toBe(MAX_REALTIME_DIFF_BYTES);
    expect(event.payload).toMatchObject({
      originalByteLength: nativeChanges.reduce(
        (bytes, change) => bytes + Buffer.byteLength(mapCodexFileChange(change).diff, "utf8"),
        0,
      ),
      truncated: true,
    });
  });

  it("truncates realtime file diffs on a valid UTF-8 boundary", () => {
    const diff = "汉".repeat(Math.ceil((MAX_REALTIME_DIFF_BYTES + 1) / 3));
    const surrogateDiff = `${"a".repeat(MAX_REALTIME_DIFF_BYTES - 1)}😀`;

    const bounded = boundRealtimeDiff(diff);
    expect(Buffer.byteLength(bounded.diff, "utf8")).toBeLessThanOrEqual(MAX_REALTIME_DIFF_BYTES);
    expect(bounded.diff).not.toContain("�");
    expect(bounded).toMatchObject({
      originalByteLength: Buffer.byteLength(diff, "utf8"),
      truncated: true,
    });

    const boundedSurrogate = boundRealtimeDiff(surrogateDiff);
    expect(Buffer.byteLength(boundedSurrogate.diff, "utf8")).toBe(MAX_REALTIME_DIFF_BYTES - 1);
    expect(boundedSurrogate.diff).not.toContain("�");
    expect(boundedSurrogate).toMatchObject({
      originalByteLength: Buffer.byteLength(surrogateDiff, "utf8"),
      truncated: true,
    });
  });

  it("maps hooks, model status, warnings, and structured errors", () => {
    expect(
      mapNotification("hook/started", {
        run: {
          eventName: "afterToolUse",
          id: "hook-1",
          status: "running",
        },
        threadId: "task-1",
        turnId: "turn-1",
      }),
    ).toMatchObject({
      itemId: "hook-hook-1",
      payload: { item: { eventName: "afterToolUse", kind: "hook", status: "running" } },
      type: "item.started",
    });
    expect(
      mapNotification("hook/completed", {
        run: {
          eventName: "sessionStart",
          id: "hook-thread",
          status: "completed",
          statusMessage: "Thread Hook 已完成",
        },
        threadId: "task-1",
        turnId: null,
      }),
    ).toMatchObject({
      payload: { code: "hook_status", level: "info", message: "Thread Hook 已完成" },
      type: "task.notice",
    });
    expect(
      mapNotification("warning", {
        message: "Process warning",
        threadId: null,
      }),
    ).toBeUndefined();
    expect(
      mapNotification("model/safetyBuffering/updated", {
        fasterModel: "gpt-mini",
        model: "gpt-main",
        reasons: [],
        showBufferingUi: true,
        threadId: "task-1",
        turnId: "turn-1",
        useCases: [],
      }),
    ).toMatchObject({
      payload: { item: { kind: "safety_buffering", status: "running" } },
      type: "item.started",
    });
    expect(
      mapNotification("model/rerouted", {
        fromModel: "gpt-main",
        reason: "highRiskCyberActivity",
        threadId: "task-1",
        toModel: "gpt-safe",
        turnId: "turn-1",
      }),
    ).toMatchObject({
      payload: { item: { fromModel: "gpt-main", kind: "model_rerouted", toModel: "gpt-safe" } },
      type: "item.completed",
    });
    expect(
      mapNotification("warning", { message: "配置即将失效", threadId: "task-1" }),
    ).toMatchObject({
      payload: { code: "runtime_warning", level: "warning" },
      type: "task.notice",
    });
    expect(
      mapNotification("autoApprovalReview/strictReviewRequired", {
        startedAtMs: 1_753_228_800_000,
        threadId: "task-1",
        turnId: "turn-1",
      }),
    ).toMatchObject({
      payload: {
        code: "strict_review_required",
        level: "warning",
        message: "Strict review is required before this action can continue.",
      },
      type: "task.notice",
    });
    expect(
      mapNotification("error", {
        error: {
          additionalDetails: null,
          codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 502 } },
          message: "连接中断",
        },
        threadId: "task-1",
        turnId: "turn-1",
        willRetry: true,
      }),
    ).toMatchObject({
      payload: { code: "connection_failed", httpStatusCode: 502, willRetry: true },
      type: "provider.error",
    });
    expect(
      mapNotification("error", {
        error: {
          additionalDetails: null,
          codexErrorInfo: "rateLimitExceeded",
          message: "请求过于频繁",
        },
        threadId: "task-1",
        turnId: "turn-1",
        willRetry: true,
      }),
    ).toMatchObject({
      payload: { code: "rate_limit_exceeded", willRetry: true },
      type: "provider.error",
    });
  });

  it("rejects invalid strict review notification fields", () => {
    expect(() =>
      mapNotification("autoApprovalReview/strictReviewRequired", {
        startedAtMs: -1,
        threadId: "task-1",
        turnId: "turn-1",
      }),
    ).toThrow("Codex strict review startedAtMs must be a non-negative integer");
    expect(() =>
      mapNotification("autoApprovalReview/strictReviewRequired", {
        startedAtMs: 1_753_228_800_000,
        threadId: "task-1",
        turnId: null,
      }),
    ).toThrow("Codex strict review turnId must be a string");
  });
});
