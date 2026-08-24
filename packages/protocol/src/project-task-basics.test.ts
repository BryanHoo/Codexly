import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
  AgentMessageItemSchema,
  AgentTaskPageSchema,
  AgentTaskSchema,
  DeleteAgentTaskResponseSchema,
  ProjectPageSchema,
  OpenAgentTaskAttachmentRequestSchema,
  OpenAgentTaskAttachmentResponseSchema,
  UnarchiveAgentTaskResponseSchema,
} from "./project.js";

describe("project task basics protocol", () => {
  it("scopes every task to a project and records its pinned state", () => {
    expect(AgentTaskSchema).toMatchObject({
      additionalProperties: false,
      properties: {
        id: { minLength: 1, type: "string" },
        pinned: { type: "boolean" },
        projectId: { minLength: 1, type: "string" },
        title: { minLength: 1, type: "string" },
        updatedAt: { format: "date-time", type: "string" },
      },
      type: "object",
    });
    expect(AgentTaskSchema.required).toEqual(["id", "pinned", "projectId", "title", "updatedAt"]);
  });

  it("carries bounded attachment metadata without snapshot content", () => {
    expect(
      Value.Check(AgentMessageItemSchema, {
        attachments: [
          {
            id: "attachment-history-1",
            kind: "image",
            mediaType: "image/png",
            name: "diagram.png",
            size: 68,
          },
        ],
        id: "message-image",
        role: "user",
        text: "",
        type: "message",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentMessageItemSchema, {
        attachments: [
          {
            id: "attachment-history-text",
            kind: "text",
            mediaType: "text/plain",
            name: "Pasted text.txt",
            size: 1_001,
          },
        ],
        id: "message-text-attachment",
        role: "user",
        text: "",
        type: "message",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentMessageItemSchema, {
        attachments: [
          {
            mediaType: "image/png",
            name: "diagram.png",
            url: "data:image/png;base64,iVBORw0KGgo=",
          },
        ],
        id: "message-image",
        role: "user",
        text: "",
        type: "message",
      }),
    ).toBe(false);
  });

  it("validates task attachment system-open requests without exposing host paths", () => {
    expect(Value.Check(OpenAgentTaskAttachmentRequestSchema, {})).toBe(true);
    expect(Value.Check(OpenAgentTaskAttachmentRequestSchema, { path: "/tmp/report.pdf" })).toBe(
      false,
    );
    expect(
      Value.Check(OpenAgentTaskAttachmentResponseSchema, {
        attachmentId: "attachment-1",
        status: "opened",
      }),
    ).toBe(true);
    expect(
      Value.Check(OpenAgentTaskAttachmentResponseSchema, {
        attachmentId: "attachment-1",
        path: "/tmp/report.pdf",
        status: "opened",
      }),
    ).toBe(false);
  });

  it("accepts only documented phases on assistant messages", () => {
    expect(
      Value.Check(AgentMessageItemSchema, {
        id: "message-commentary",
        phase: "commentary",
        role: "assistant",
        text: "正在检查。",
        type: "message",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentMessageItemSchema, {
        id: "message-final",
        phase: "final_answer",
        role: "assistant",
        text: "检查完成。",
        type: "message",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentMessageItemSchema, {
        id: "message-invalid",
        phase: "analysis",
        role: "assistant",
        text: "不可见阶段。",
        type: "message",
      }),
    ).toBe(false);
  });

  it("validates paginated projects and tasks", () => {
    expect(
      Value.Check(ProjectPageSchema, {
        data: [
          {
            createdAt: "2026-07-23T00:00:00.000Z",
            id: "code-agent",
            name: "CodeAgent",
            roots: [{ id: "root-code-agent", path: "/workspace/CodeAgent" }],
          },
        ],
        nextCursor: null,
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentTaskPageSchema, {
        data: [
          {
            id: "task-1",
            pinned: false,
            projectId: "code-agent",
            title: "实现真实任务历史",
            updatedAt: "2026-07-23T00:00:00.000Z",
          },
        ],
        nextCursor: "next-page",
      }),
    ).toBe(true);
  });

  it("validates strict archived task mutation responses", () => {
    const task = {
      id: "task-1",
      pinned: false,
      projectId: "code-agent",
      title: "恢复归档任务",
      updatedAt: "2026-08-23T00:00:00.000Z",
    };

    expect(Value.Check(UnarchiveAgentTaskResponseSchema, { task })).toBe(true);
    expect(Value.Check(DeleteAgentTaskResponseSchema, { status: "deleted", taskId: task.id })).toBe(
      true,
    );
    expect(
      Value.Check(DeleteAgentTaskResponseSchema, {
        status: "deleted",
        task,
        taskId: task.id,
      }),
    ).toBe(false);
  });
});
