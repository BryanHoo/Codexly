import type { AgentRuntimeProvider } from "@codexly/core";
import type { Project } from "@codexly/protocol";
import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createCodexlyServer } from "./app.js";
import {
  project,
  pixelDataUrl,
  turnOptions,
  isRecord,
  multipartAttachment,
  closeCallbacks,
  createProvider,
  createRuntimeConnectionMethods,
  createServerOptions,
} from "./app-all.test-support.js";

describe("server project management", () => {
  it("browses host directories and adds the explicitly selected project", async () => {
    const { provider } = createProvider();
    const selectedPath = "/Users/bryan/Develop/Codexly";
    const selectedProject = {
      ...project,
      roots: [{ id: "root-selected", path: selectedPath }],
    };
    const register = vi.fn(() => Promise.resolve(selectedProject));
    const readProjectDirectory = vi.fn(() =>
      Promise.resolve({
        entries: [{ name: "Codexly", path: selectedPath }],
        parentPath: "/Users/bryan",
        path: "/Users/bryan/Develop",
        roots: [],
      }),
    );
    const resolveProjectDirectory = vi.fn(() => Promise.resolve(selectedPath));
    const app = await createCodexlyServer(
      createServerOptions(provider, {
        projectRepository: {
          list: () => Promise.resolve([]),
          read: () => Promise.resolve(undefined),
          register,
        },
        readProjectDirectory,
        resolveProjectDirectory,
      }),
    );
    closeCallbacks.push(() => app.close());

    const listing = await app.inject({
      method: "GET",
      url: "/v1/project-directories?path=%2FUsers%2Fbryan%2FDevelop&includeHidden=true",
    });
    const response = await app.inject({
      headers: { "idempotency-key": "add-project" },
      method: "POST",
      payload: { roots: [{ path: selectedPath }] },
      url: "/v1/projects",
    });

    expect(listing.statusCode).toBe(200);
    expect(listing.json()).toMatchObject({ path: "/Users/bryan/Develop" });
    expect(readProjectDirectory).toHaveBeenCalledWith("/Users/bryan/Develop", {
      includeHidden: true,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ project: selectedProject });
    expect(resolveProjectDirectory).toHaveBeenCalledWith(selectedPath);
    expect(register).toHaveBeenCalledWith({
      idempotencyKey: "add-project",
      name: "Codexly",
      roots: [{ path: selectedPath }],
    });
  });

  it("browses supported host files and imports a selected file idempotently", async () => {
    const { provider } = createProvider();
    const selectedPath = "/Users/bryan/Pictures/screen.png";
    const listing = {
      entries: [
        { name: "design", path: "/Users/bryan/Pictures/design", type: "directory" as const },
        { name: "screen.png", path: selectedPath, type: "file" as const },
      ],
      parentPath: "/Users/bryan",
      path: "/Users/bryan/Pictures",
      roots: [],
    };
    const readHostFileDirectory = vi.fn(() => Promise.resolve(listing));
    const resolveHostAttachment = vi.fn(() =>
      Promise.resolve({
        content: Readable.from(Buffer.from(pixelDataUrl.split(",")[1] ?? "", "base64")),
        kind: "image" as const,
        mediaType: "image/png" as const,
        name: "screen.png",
      }),
    );
    const app = await createCodexlyServer(
      createServerOptions(provider, { readHostFileDirectory, resolveHostAttachment }),
    );
    closeCallbacks.push(() => app.close());

    const files = await app.inject({
      method: "GET",
      url: "/v1/host-files?kind=image&path=%2FUsers%2Fbryan%2FPictures&includeHidden=true",
    });
    const importRequest = {
      headers: { "idempotency-key": "import-host-image" },
      method: "POST" as const,
      payload: { path: selectedPath },
      url: "/v1/projects/codexly/attachments/image/host",
    };
    const imported = await app.inject(importRequest);
    const repeated = await app.inject(importRequest);
    const importedBody: unknown = imported.json();
    const importedAttachment = isRecord(importedBody) ? importedBody["attachment"] : undefined;
    const importedAttachmentId =
      isRecord(importedAttachment) && typeof importedAttachment["id"] === "string"
        ? importedAttachment["id"]
        : undefined;
    if (importedAttachmentId === undefined) {
      throw new Error("Imported host attachment response is invalid");
    }
    const preview = await app.inject({
      method: "GET",
      url: `/v1/projects/codexly/attachments/${encodeURIComponent(importedAttachmentId)}`,
    });
    const missingPreview = await app.inject({
      method: "GET",
      url: "/v1/projects/codexly/attachments/missing",
    });
    const resolveCallsBeforeMissingProject = resolveHostAttachment.mock.calls.length;
    const missingProject = await app.inject({
      ...importRequest,
      headers: { "idempotency-key": "missing-project-host-image" },
      url: "/v1/projects/missing/attachments/image/host",
    });

    expect(files.statusCode).toBe(200);
    expect(files.json()).toEqual(listing);
    expect(readHostFileDirectory).toHaveBeenCalledWith("image", "/Users/bryan/Pictures", {
      includeHidden: true,
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.json()).toMatchObject({
      attachment: { kind: "image", mediaType: "image/png", name: "screen.png", size: 68 },
    });
    expect(repeated.json()).toEqual(imported.json());
    expect(preview.statusCode).toBe(200);
    expect(preview.headers["content-type"]).toBe("image/png");
    expect(preview.headers["cache-control"]).toBe("no-store");
    expect(preview.rawPayload).toEqual(Buffer.from(pixelDataUrl.split(",")[1] ?? "", "base64"));
    expect(missingPreview.statusCode).toBe(404);
    expect(resolveHostAttachment).toHaveBeenCalledWith("image", selectedPath);
    expect(missingProject.statusCode).toBe(404);
    expect(resolveHostAttachment).toHaveBeenCalledTimes(resolveCallsBeforeMissingProject);
  });

  it("renames and removes only the registered project idempotently", async () => {
    const providerHarness = createProvider();
    let storedProject: Project | undefined = project;
    const read = vi.fn((projectId: string) =>
      Promise.resolve(storedProject?.id === projectId ? storedProject : undefined),
    );
    const rename = vi.fn((_projectId: string, name: string) => {
      storedProject = storedProject === undefined ? undefined : { ...storedProject, name };
      return Promise.resolve(storedProject);
    });
    const remove = vi.fn((projectId: string) => {
      if (storedProject?.id !== projectId) {
        return Promise.resolve(false);
      }
      storedProject = undefined;
      return Promise.resolve(true);
    });
    const app = await createCodexlyServer(
      createServerOptions(providerHarness.provider, {
        projectRepository: {
          list: () => Promise.resolve(storedProject === undefined ? [] : [storedProject]),
          read,
          register: () => Promise.resolve(project),
          remove,
          rename,
          reorder: () => Promise.resolve(storedProject === undefined ? [] : [storedProject]),
        },
      }),
    );
    closeCallbacks.push(() => app.close());
    await app.inject({ method: "GET", url: "/v1/projects/codexly/skills" });
    const readsAfterContextCreation = read.mock.calls.length;
    const cachedContextResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/codexly/tasks",
    });
    expect(providerHarness.eventListeners.size).toBe(1);
    expect(cachedContextResponse.statusCode).toBe(200);
    expect(read).toHaveBeenCalledTimes(readsAfterContextCreation);

    const renameRequest = {
      headers: { "idempotency-key": "rename-project-key" },
      method: "POST" as const,
      payload: { name: "  工作区别名  " },
      url: "/v1/projects/codexly/rename",
    };
    const firstRenameResponse = await app.inject(renameRequest);
    const repeatedRenameResponse = await app.inject(renameRequest);
    const renamedContextResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/codexly/tasks",
    });
    expect(renamedContextResponse.statusCode).toBe(200);
    expect(read).toHaveBeenCalledTimes(readsAfterContextCreation);
    const invalidRenameResponse = await app.inject({
      ...renameRequest,
      headers: { "idempotency-key": "invalid-project-name" },
      payload: { name: "   " },
    });
    const removeRequest = {
      headers: { "idempotency-key": "remove-project-key" },
      method: "POST" as const,
      payload: {},
      url: "/v1/projects/codexly/remove",
    };
    const firstRemoveResponse = await app.inject(removeRequest);
    const repeatedRemoveResponse = await app.inject(removeRequest);
    const missingRemoveResponse = await app.inject({
      ...removeRequest,
      headers: { "idempotency-key": "missing-project-key" },
    });
    const removedContextResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/codexly/tasks",
    });

    expect(firstRenameResponse.json()).toEqual({
      project: { ...project, name: "工作区别名" },
    });
    expect(repeatedRenameResponse.json()).toEqual(firstRenameResponse.json());
    expect(rename).toHaveBeenCalledOnce();
    expect(rename).toHaveBeenCalledWith(project.id, "工作区别名");
    expect(invalidRenameResponse.statusCode).toBe(400);
    expect(firstRemoveResponse.json()).toEqual({ projectId: project.id, status: "removed" });
    expect(repeatedRemoveResponse.json()).toEqual(firstRemoveResponse.json());
    // 成功请求只执行一次；第二次调用来自使用新 Key 的缺失资源验证。
    expect(remove).toHaveBeenCalledTimes(2);
    expect(providerHarness.eventListeners.size).toBe(0);
    expect(missingRemoveResponse.statusCode).toBe(404);
    expect(removedContextResponse.statusCode).toBe(404);
    expect(read).toHaveBeenCalledTimes(readsAfterContextCreation + 1);
  });

  it("releases runtime and uploaded attachment state when removing a project", async () => {
    const providerHarness = createProvider();
    let storedProject: Project | undefined = project;
    const releaseProject = vi.fn(() => Promise.resolve());
    const runtimeProvider: AgentRuntimeProvider = {
      ...createRuntimeConnectionMethods(),
      forProject: () => providerHarness.provider,
      forTemporary: () => providerHarness.provider,
      getCapabilities: () => providerHarness.provider.getCapabilities(),
      listModels: () => providerHarness.provider.listModels(),
      readDefaultSettings: () => Promise.resolve({}),
      releaseProject,
    };
    const app = await createCodexlyServer(
      createServerOptions(providerHarness.provider, {
        projectRepository: {
          list: () => Promise.resolve(storedProject === undefined ? [] : [storedProject]),
          read: (projectId: string) =>
            Promise.resolve(storedProject?.id === projectId ? storedProject : undefined),
          register: () => Promise.resolve(project),
          remove: (projectId: string) => {
            if (storedProject?.id !== projectId) {
              return Promise.resolve(false);
            }
            storedProject = undefined;
            return Promise.resolve(true);
          },
          rename: () => Promise.resolve(undefined),
          reorder: () => Promise.resolve(storedProject === undefined ? [] : [storedProject]),
        },
        provider: runtimeProvider,
      }),
    );
    closeCallbacks.push(() => app.close());
    const upload = await app.inject(
      await multipartAttachment(
        "image",
        "screen.png",
        "image/png",
        Buffer.from(pixelDataUrl.split(",")[1] ?? "", "base64"),
        "release-project-upload",
      ),
    );
    const attachmentId = upload.json<{ attachment: { id: string } }>().attachment.id;

    const removed = await app.inject({
      headers: { "idempotency-key": "release-project" },
      method: "POST",
      payload: {},
      url: "/v1/projects/codexly/remove",
    });
    storedProject = project;
    const reuse = await app.inject({
      headers: { "idempotency-key": "reuse-released-attachment" },
      method: "POST",
      payload: {
        input: { attachments: [{ id: attachmentId }], skills: [], text: "", type: "prompt" },
        options: turnOptions,
      },
      url: "/v1/projects/codexly/tasks/task-1/turns",
    });

    expect(removed.statusCode).toBe(200);
    expect(releaseProject).toHaveBeenCalledOnce();
    expect(releaseProject).toHaveBeenCalledWith(project.id, providerHarness.provider);
    expect(reuse.statusCode).toBe(404);
    expect(reuse.json()).toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
    expect(providerHarness.startTurn).not.toHaveBeenCalled();
  });
});
