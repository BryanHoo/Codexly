import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
  AddAgentQueuedSubmissionRequestSchema,
  AgentQueuedSubmissionPageSchema,
  ReorderAgentQueuedSubmissionsRequestSchema,
  StartAgentQueuedSubmissionResponseSchema,
  UpdateAgentQueuedSubmissionRequestSchema,
  AddProjectRequestSchema,
  AddProjectResponseSchema,
  TEMPORARY_TASK_API_PATH,
  TEMPORARY_TASK_SCOPE_ID,
  HostFileListingSchema,
  HostFileQuerySchema,
  ImportHostAttachmentRequestSchema,
  ProjectDirectoryListingSchema,
  ProjectDirectoryQuerySchema,
} from "./project.js";

describe("project registration protocol", () => {
  it("validates the complete task queue contract", () => {
    const input = { attachments: [], skills: [], text: "继续实现", type: "prompt" } as const;
    const queuedSubmission = {
      attachments: [],
      clientUserMessageId: "client-message-1",
      id: "queue-1",
      skills: [],
      text: "继续实现",
    };

    expect(
      Value.Check(AddAgentQueuedSubmissionRequestSchema, {
        clientUserMessageId: "client-message-1",
        input,
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentQueuedSubmissionPageSchema, {
        data: [queuedSubmission],
        nextCursor: null,
      }),
    ).toBe(true);
    expect(Value.Check(UpdateAgentQueuedSubmissionRequestSchema, { input })).toBe(true);
    expect(
      Value.Check(ReorderAgentQueuedSubmissionsRequestSchema, {
        queuedSubmissionIds: ["queue-2", "queue-1"],
      }),
    ).toBe(true);
    expect(
      Value.Check(ReorderAgentQueuedSubmissionsRequestSchema, {
        queuedSubmissionIds: ["queue-1", "queue-1"],
      }),
    ).toBe(false);
    expect(
      Value.Check(StartAgentQueuedSubmissionResponseSchema, {
        taskId: "task-1",
        turn: {
          completedAt: null,
          error: null,
          id: "turn-2",
          items: [],
          startedAt: null,
          status: "running",
        },
      }),
    ).toBe(true);
  });

  it("defines a stable public scope for temporary tasks", () => {
    expect(TEMPORARY_TASK_SCOPE_ID).toBe("temporary");
    expect(TEMPORARY_TASK_API_PATH).toBe("/v1/temporary");
  });

  it("requires ordered absolute roots when adding a project", () => {
    const project = {
      createdAt: "2026-07-25T00:00:00.000Z",
      id: "code-agent",
      name: "CodeAgent",
      roots: [
        { id: "root-code-agent", path: "/workspace/CodeAgent" },
        { id: "root-superwork", path: "/workspace/superwork" },
      ],
    };

    expect(
      Value.Check(AddProjectRequestSchema, {
        roots: project.roots.map(({ path }) => ({ path })),
      }),
    ).toBe(true);
    expect(Value.Check(AddProjectRequestSchema, { roots: [] })).toBe(false);
    expect(Value.Check(AddProjectRequestSchema, { roots: [{ path: "workspace/CodeAgent" }] })).toBe(
      false,
    );
    expect(Value.Check(AddProjectResponseSchema, { project })).toBe(true);
    expect(Value.Check(AddProjectResponseSchema, { project: null })).toBe(false);
  });

  it("validates host directory queries and listings", () => {
    expect(Value.Check(ProjectDirectoryQuerySchema, {})).toBe(true);
    expect(Value.Check(ProjectDirectoryQuerySchema, { path: "/Users/bryan/Develop" })).toBe(true);
    expect(
      Value.Check(ProjectDirectoryQuerySchema, {
        includeHidden: true,
        path: "/Users/bryan/Develop",
      }),
    ).toBe(true);
    expect(
      Value.Check(ProjectDirectoryQuerySchema, {
        includeHidden: "true",
        path: "/Users/bryan/Develop",
      }),
    ).toBe(false);
    expect(Value.Check(ProjectDirectoryQuerySchema, { path: "C:\\Users\\bryan\\Develop" })).toBe(
      true,
    );
    expect(Value.Check(ProjectDirectoryQuerySchema, { path: "relative/project" })).toBe(false);
    expect(
      Value.Check(ProjectDirectoryListingSchema, {
        entries: [
          { name: "CodeAgent", path: "/Users/bryan/Develop/CodeAgent" },
          { name: "superwork", path: "/Users/bryan/Develop/superwork" },
        ],
        parentPath: "/Users/bryan",
        path: "/Users/bryan/Develop",
        roots: [{ name: "C:", path: "C:\\" }],
      }),
    ).toBe(true);
    expect(
      Value.Check(ProjectDirectoryListingSchema, {
        entries: [],
        parentPath: null,
        path: "C:\\",
      }),
    ).toBe(false);
  });

  it("validates host attachment file queries, listings, and imports", () => {
    expect(Value.Check(HostFileQuerySchema, { kind: "image" })).toBe(true);
    expect(
      Value.Check(HostFileQuerySchema, {
        includeHidden: true,
        kind: "file",
        path: "C:\\Users\\bryan\\Documents",
      }),
    ).toBe(true);
    expect(Value.Check(HostFileQuerySchema, { includeHidden: "true", kind: "file" })).toBe(false);
    expect(Value.Check(HostFileQuerySchema, { kind: "text" })).toBe(false);
    expect(Value.Check(HostFileQuerySchema, { kind: "file", path: "relative/path" })).toBe(false);
    expect(Value.Check(HostFileQuerySchema, { extra: true, kind: "file" })).toBe(false);

    expect(
      Value.Check(HostFileListingSchema, {
        entries: [
          { name: "design", path: "/Users/bryan/design", type: "directory" },
          { name: "screen.png", path: "/Users/bryan/screen.png", type: "file" },
        ],
        parentPath: "/Users",
        path: "/Users/bryan",
        roots: [
          { name: "C:", path: "C:\\" },
          { name: "D:", path: "D:\\" },
        ],
      }),
    ).toBe(true);
    expect(
      Value.Check(HostFileListingSchema, {
        entries: [{ name: "screen.png", path: "relative/screen.png", type: "file" }],
        parentPath: null,
        path: "/",
      }),
    ).toBe(false);

    expect(
      Value.Check(ImportHostAttachmentRequestSchema, { path: "/Users/bryan/screen.png" }),
    ).toBe(true);
    expect(Value.Check(ImportHostAttachmentRequestSchema, { path: "screen.png" })).toBe(false);
    expect(
      Value.Check(ImportHostAttachmentRequestSchema, {
        extra: true,
        path: "/Users/bryan/screen.png",
      }),
    ).toBe(false);
  });
});
