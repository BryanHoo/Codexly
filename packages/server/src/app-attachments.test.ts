import { MAX_AGENT_IMAGE_BYTES } from "@codexly/protocol";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type { ProjectOpenService } from "./project-open.js";
import {
  projectRootPath,
  pixelDataUrl,
  pastedTextDataUrl,
  historicalImageContent,
  turnOptions,
  multipartAttachment,
  turnRequest,
  createHarness,
} from "./app-all.test-support.js";

describe("server attachments and catalogs", () => {
  it("serves models and resolves uploaded attachments before starting a turn", async () => {
    const {
      app,
      listMcpServers,
      listModels,
      listSkills,
      reloadMcpServers,
      startTurn,
      writeTaskSettings,
    } = await createHarness();
    const models = await app.inject({ method: "GET", url: "/v1/models" });
    const mcpServers = await app.inject({
      method: "GET",
      url: "/v1/projects/codexly/tasks/task-1/mcp-servers",
    });
    const reloadedMcpServers = await app.inject({
      headers: { "idempotency-key": "reload-task-mcp" },
      method: "POST",
      payload: {},
      url: "/v1/projects/codexly/tasks/task-1/mcp-servers/retry",
    });
    const skills = await app.inject({ method: "GET", url: "/v1/projects/codexly/skills" });
    const uploadRequest = await multipartAttachment(
      "image",
      "screen.png",
      "image/png",
      Buffer.from(pixelDataUrl.split(",")[1] ?? "", "base64"),
      "upload-1",
    );
    const uploaded = await app.inject(uploadRequest);
    const repeatedUpload = await app.inject(uploadRequest);
    const attachment = uploaded.json<{ attachment: { id: string } }>().attachment;
    const turn = await app.inject({
      headers: { "idempotency-key": "attachment-turn" },
      method: "POST",
      payload: {
        input: { attachments: [{ id: attachment.id }], skills: [], text: "", type: "prompt" },
        options: turnOptions,
      },
      url: "/v1/projects/codexly/tasks/task-1/turns",
    });
    const invalidTurn = await app.inject({
      headers: { "idempotency-key": "invalid-turn-settings" },
      method: "POST",
      payload: {
        ...turnRequest("无效设置"),
        options: { ...turnOptions, reasoningEffort: "low" },
      },
      url: "/v1/projects/codexly/tasks/task-1/turns",
    });
    const consumed = await app.inject({
      headers: { "idempotency-key": "attachment-consumed" },
      method: "POST",
      payload: {
        input: { attachments: [{ id: attachment.id }], skills: [], text: "", type: "prompt" },
        options: turnOptions,
      },
      url: "/v1/projects/codexly/tasks/task-1/turns",
    });

    expect(models.statusCode).toBe(200);
    expect(models.json()).toMatchObject({
      data: [
        { id: "gpt-5.6-luna", isDefault: false },
        { id: "gpt-5.6-sol", isDefault: true },
      ],
    });
    expect(mcpServers.statusCode).toBe(200);
    expect(mcpServers.json()).toEqual({
      data: [
        expect.objectContaining({
          name: "fast-context",
          status: "connected",
          toolCount: 2,
        }),
        expect.objectContaining({
          name: "chrome-devtools",
          status: "connected",
          toolCount: 2,
        }),
      ],
    });
    expect(listMcpServers).toHaveBeenCalledOnce();
    expect(listMcpServers).toHaveBeenCalledWith("task-1");
    expect(reloadedMcpServers.statusCode).toBe(200);
    expect(reloadedMcpServers.json()).toMatchObject({
      data: [{ name: "fast-context", status: "starting" }],
    });
    expect(reloadMcpServers).toHaveBeenCalledWith("task-1");
    expect(skills.statusCode).toBe(200);
    expect(skills.json()).toMatchObject({ data: [{ name: "review-security" }] });
    expect(listSkills).toHaveBeenCalledOnce();
    expect(listModels).toHaveBeenCalledOnce();
    expect(uploaded.statusCode).toBe(201);
    expect(repeatedUpload.json()).toEqual(uploaded.json());
    expect(uploaded.json()).toMatchObject({
      attachment: { kind: "image", mediaType: "image/png", name: "screen.png", size: 68 },
    });
    expect(turn.statusCode).toBe(201);
    expect(invalidTurn.statusCode).toBe(400);
    expect(startTurn).toHaveBeenCalledOnce();
    expect(writeTaskSettings).toHaveBeenCalledOnce();
    expect(startTurn).toHaveBeenCalledWith(
      "task-1",
      {
        files: [],
        images: [{ mediaType: "image/png", url: pixelDataUrl }],
        skills: [],
        text: "",
        textAttachments: [],
      },
      turnOptions,
    );
    expect(consumed.statusCode).toBe(404);
    expect(consumed.json()).toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
  });

  it("preserves original Codex MCP errors for reads and reloads", async () => {
    const { app, listMcpServers, reloadMcpServers } = await createHarness();
    listMcpServers.mockRejectedValueOnce(
      new Error("mcpServerStatus/list failed: MCP server `docs` executable was not found"),
    );
    reloadMcpServers.mockRejectedValueOnce(
      new Error("config/mcpServer/reload failed: transport channel closed"),
    );

    const readResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/codexly/tasks/task-1/mcp-servers",
    });
    const reloadResponse = await app.inject({
      headers: { "idempotency-key": "reload-task-mcp-error" },
      method: "POST",
      payload: {},
      url: "/v1/projects/codexly/tasks/task-1/mcp-servers/retry",
    });

    expect(readResponse.statusCode).toBe(502);
    expect(readResponse.json()).toEqual({
      code: "PROVIDER_ERROR",
      message: "mcpServerStatus/list failed: MCP server `docs` executable was not found",
      retryable: true,
    });
    expect(reloadResponse.statusCode).toBe(502);
    expect(reloadResponse.json()).toEqual({
      code: "PROVIDER_ERROR",
      message: "config/mcpServer/reload failed: transport channel closed",
      retryable: true,
    });
  });

  it("rejects oversized or non-multipart attachments before parsing file data", async () => {
    const { app } = await createHarness();
    const oversized = await app.inject({
      headers: {
        "content-length": String(MAX_AGENT_IMAGE_BYTES + 64 * 1024 + 1),
        "content-type": "multipart/form-data; boundary=attachment-boundary",
        "idempotency-key": "oversized-image",
      },
      method: "POST",
      payload: "body must not be parsed",
      url: "/v1/projects/codexly/attachments/image",
    });
    const json = await app.inject({
      headers: { "idempotency-key": "legacy-json" },
      method: "POST",
      payload: { dataUrl: pixelDataUrl, kind: "image", name: "screen.png" },
      url: "/v1/projects/codexly/attachments/image",
    });

    expect(oversized.statusCode).toBe(413);
    expect(oversized.json()).toMatchObject({ code: "INVALID_REQUEST" });
    expect(json.statusCode).toBe(400);
    expect(json.json()).toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("resolves pasted text attachments separately from image inputs", async () => {
    const { app, startTurn } = await createHarness();
    const uploaded = await app.inject(
      await multipartAttachment(
        "text",
        "Pasted text.txt",
        "text/plain",
        Buffer.from(pastedTextDataUrl.split(",")[1] ?? "", "base64"),
        "upload-pasted-text",
      ),
    );
    const attachment = uploaded.json<{ attachment: { id: string } }>().attachment;

    const turn = await app.inject({
      headers: { "idempotency-key": "pasted-text-turn" },
      method: "POST",
      payload: {
        input: { attachments: [{ id: attachment.id }], skills: [], text: "", type: "prompt" },
        options: turnOptions,
      },
      url: "/v1/projects/codexly/tasks/task-1/turns",
    });

    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json()).toMatchObject({
      attachment: {
        kind: "text",
        mediaType: "text/plain",
        name: "Pasted text.txt",
        size: 14,
      },
    });
    expect(turn.statusCode).toBe(201);
    expect(startTurn).toHaveBeenCalledWith(
      "task-1",
      {
        files: [],
        images: [],
        skills: [],
        text: "",
        textAttachments: [{ name: "Pasted text.txt", text: "你好 Codexly" }],
      },
      turnOptions,
    );
  });

  it("serves historical attachment bytes through the project task scope", async () => {
    const { app, readTaskAttachment } = await createHarness();

    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/codexly/tasks/task-1/attachments/history%2Fimage-1",
    });
    const missingAttachment = await app.inject({
      method: "GET",
      url: "/v1/projects/codexly/tasks/task-1/attachments/missing",
    });
    const missingProject = await app.inject({
      method: "GET",
      url: "/v1/projects/missing/tasks/task-1/attachments/history%2Fimage-1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(historicalImageContent);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(missingAttachment.statusCode).toBe(404);
    expect(missingProject.statusCode).toBe(404);
    expect(readTaskAttachment).toHaveBeenCalledTimes(2);
    expect(readTaskAttachment).toHaveBeenNthCalledWith(1, "task-1", "history/image-1");
  });

  it("serves a submitted attachment before the Provider history is available", async () => {
    const { app, readTaskAttachment } = await createHarness();
    const imageContent = Buffer.from(pixelDataUrl.split(",")[1] ?? "", "base64");
    const uploaded = await app.inject(
      await multipartAttachment(
        "image",
        "screen.png",
        "image/png",
        imageContent,
        "upload-pending-image",
      ),
    );
    const attachment = uploaded.json<{ attachment: { id: string } }>().attachment;

    const turn = await app.inject({
      headers: { "idempotency-key": "pending-image-turn" },
      method: "POST",
      payload: {
        input: { attachments: [{ id: attachment.id }], skills: [], text: "", type: "prompt" },
        options: turnOptions,
      },
      url: "/v1/projects/codexly/tasks/task-1/turns",
    });
    const preview = await app.inject({
      method: "GET",
      url: `/v1/projects/codexly/tasks/task-1/attachments/${attachment.id}`,
    });

    expect(turn.statusCode).toBe(201);
    expect(preview.statusCode).toBe(200);
    expect(preview.headers["content-type"]).toBe("image/png");
    expect(preview.headers["x-content-type-options"]).toBe("nosniff");
    expect(preview.rawPayload).toEqual(imageContent);
    expect(readTaskAttachment).toHaveBeenCalledWith("task-1", attachment.id);
  });

  it("opens an authorized task file attachment with the system application", async () => {
    const fileContent = Buffer.from("%PDF-1.7\nattachment\n", "utf8");
    const open = vi.fn<ProjectOpenService["open"]>(async (_root, appId, path) => {
      expect(appId).toBe("system-default");
      expect(path).toBeDefined();
      await expect(readFile(path ?? "")).resolves.toEqual(fileContent);
    });
    const { app } = await createHarness({
      projectOpenService: {
        getCapabilities: () => Promise.resolve({ apps: [], platform: "darwin" }),
        open,
      },
    });
    const uploaded = await app.inject(
      await multipartAttachment(
        "file",
        "report.pdf",
        "application/pdf",
        fileContent,
        "upload-open-file",
      ),
    );
    const attachment = uploaded.json<{ attachment: { id: string } }>().attachment;
    await app.inject({
      headers: { "idempotency-key": "open-file-turn" },
      method: "POST",
      payload: {
        input: { attachments: [{ id: attachment.id }], skills: [], text: "", type: "prompt" },
        options: turnOptions,
      },
      url: "/v1/projects/codexly/tasks/task-1/turns",
    });

    const response = await app.inject({
      headers: { "idempotency-key": "open-task-attachment" },
      method: "POST",
      payload: {},
      url: `/v1/projects/codexly/tasks/task-1/attachments/${attachment.id}/open`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ attachmentId: attachment.id, status: "opened" });
    expect(open).toHaveBeenCalledWith(projectRootPath, "system-default", expect.any(String));
  });
});
