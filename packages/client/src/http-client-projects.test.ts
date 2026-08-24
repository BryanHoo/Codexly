import { describe, expect, it, vi } from "vitest";
import {
  buildProjectAttachmentUrl,
  buildProjectImageFileUrl,
  CodexlyClient,
} from "./http-client.js";
import {
  task,
  taskSettings,
  attachment,
  projectRootPath,
  jsonResponse,
} from "./http-client.test-support.js";

describe("CodexlyClient project routes", () => {
  it("builds encoded Project image preview URLs", () => {
    expect(
      buildProjectImageFileUrl(
        "http://127.0.0.1:3210/",
        "sample project",
        "/workspace/Codexly/design/result image.png",
      ),
    ).toBe(
      "http://127.0.0.1:3210/v1/projects/sample%20project/files/image?path=%2Fworkspace%2FCodexly%2Fdesign%2Fresult+image.png",
    );
  });

  it("builds opaque pending attachment preview URLs", () => {
    expect(buildProjectAttachmentUrl("http://127.0.0.1:3210/", "sample project", "image/1")).toBe(
      "http://127.0.0.1:3210/v1/projects/sample%20project/attachments/image%2F1",
    );
  });

  it("builds encoded historical attachment URLs from the configured base URL", () => {
    const client = new CodexlyClient({ baseUrl: "http://127.0.0.1:3210/" });

    expect(client.getTaskAttachmentUrl("项目 / one", "task/1", "image?1")).toBe(
      "http://127.0.0.1:3210/v1/projects/%E9%A1%B9%E7%9B%AE%20%2F%20one/tasks/task%2F1/attachments/image%3F1",
    );
  });

  it("lists and terminates a task background terminal", async () => {
    const terminalPage = {
      data: [
        {
          command: "pnpm dev",
          cwd: "/workspace/Codexly",
          id: "terminal/1",
          itemId: "command-1",
        },
      ],
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(terminalPage))
      .mockResolvedValueOnce(jsonResponse({ status: "terminated", terminalId: "terminal/1" }));
    const client = new CodexlyClient({ fetch: fetchMock });

    await expect(client.listBackgroundTerminals("project one", "task one")).resolves.toEqual(
      terminalPage,
    );
    await expect(
      client.terminateBackgroundTerminal("project one", "task one", "terminal/1", {
        idempotencyKey: "stop-terminal",
      }),
    ).resolves.toEqual({ status: "terminated", terminalId: "terminal/1" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/projects/project%20one/tasks/task%20one/background-terminals",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/v1/projects/project%20one/tasks/task%20one/background-terminals/terminal%2F1/terminate",
    );
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("idempotency-key")).toBe(
      "stop-terminal",
    );
  });

  it("browses host directories and registers the selected project path", async () => {
    const primaryRootPath = "/Users/bryan/Develop/Codexly";
    const project = {
      createdAt: "2026-07-23T00:00:00.000Z",
      id: "codexly",
      name: "Codexly",
      roots: [
        { id: "root-codexly", path: primaryRootPath },
        { id: "root-codexly-docs", path: "/Users/bryan/Develop/CodexlyDocs" },
      ],
    };
    const listing = {
      entries: [{ name: "Codexly", path: primaryRootPath }],
      parentPath: "/Users/bryan",
      path: "/Users/bryan/Develop",
      roots: [],
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(listing))
      .mockResolvedValueOnce(jsonResponse(listing))
      .mockResolvedValueOnce(jsonResponse({ project }));
    const client = new CodexlyClient({ fetch: fetchMock });

    await expect(client.listProjectDirectories(listing.path)).resolves.toEqual(listing);
    await expect(
      client.listProjectDirectories(listing.path, { includeHidden: true }),
    ).resolves.toEqual(listing);
    await expect(
      client.addProject(
        project.roots.map((root) => root.path),
        { idempotencyKey: "project-key" },
      ),
    ).resolves.toEqual({
      project,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/project-directories?path=%2FUsers%2Fbryan%2FDevelop",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/v1/project-directories?path=%2FUsers%2Fbryan%2FDevelop&includeHidden=true",
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/v1/projects");
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      body: JSON.stringify({ roots: project.roots.map(({ path }) => ({ path })) }),
      method: "POST",
    });
  });

  it("browses host attachment files and imports the selected host path", async () => {
    const selectedPath = "/Users/bryan/Pictures/screen image.png";
    const listing = {
      entries: [{ name: "screen image.png", path: selectedPath, type: "file" as const }],
      parentPath: "/Users/bryan",
      path: "/Users/bryan/Pictures",
      roots: [],
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(listing))
      .mockResolvedValueOnce(jsonResponse({ attachment }));
    const client = new CodexlyClient({ fetch: fetchMock });

    await expect(
      client.listHostFiles("image", listing.path, { includeHidden: true }),
    ).resolves.toEqual(listing);
    await expect(
      client.importHostAttachment("sample project", "image", selectedPath, {
        idempotencyKey: "host-image-key",
      }),
    ).resolves.toEqual({ attachment });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/host-files?kind=image&path=%2FUsers%2Fbryan%2FPictures&includeHidden=true",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/v1/projects/sample%20project/attachments/image/host",
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ path: selectedPath }),
      method: "POST",
    });
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("idempotency-key")).toBe(
      "host-image-key",
    );
  });

  it("renames and removes an encoded project id with idempotency keys", async () => {
    const renamedProject = {
      createdAt: "2026-07-23T00:00:00.000Z",
      id: "project / one",
      name: "工作区别名",
      roots: [{ id: "root-codexly", path: projectRootPath }],
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ project: renamedProject }))
      .mockResolvedValueOnce(jsonResponse({ projectId: renamedProject.id, status: "removed" }));
    const client = new CodexlyClient({ fetch: fetchMock });

    await expect(
      client.renameProject(renamedProject.id, "工作区别名", {
        idempotencyKey: "rename-project-key",
      }),
    ).resolves.toEqual({ project: renamedProject });
    await expect(
      client.removeProject(renamedProject.id, { idempotencyKey: "remove-project-key" }),
    ).resolves.toEqual({ projectId: renamedProject.id, status: "removed" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/projects/project%20%2F%20one/rename");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({ name: "工作区别名" }),
      method: "POST",
    });
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("idempotency-key")).toBe(
      "rename-project-key",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/v1/projects/project%20%2F%20one/remove");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ body: "{}", method: "POST" });
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("idempotency-key")).toBe(
      "remove-project-key",
    );
  });

  it("reads available project open targets and opens a selected target", async () => {
    const capabilities = {
      apps: [
        { id: "zed", kind: "editor", name: "Zed" },
        { id: "finder", kind: "file-manager", name: "Finder" },
      ],
      platform: "darwin",
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(capabilities))
      .mockResolvedValueOnce(jsonResponse({ appId: "zed", path: "src/components/app.tsx" }));
    const client = new CodexlyClient({ fetch: fetchMock });

    await expect(client.getProjectOpenCapabilities("project one")).resolves.toEqual(capabilities);
    await expect(
      client.openProject(
        "project one",
        projectRootPath,
        { appId: "zed", path: "src/components/app.tsx" },
        { idempotencyKey: "open-project-key" },
      ),
    ).resolves.toEqual({ appId: "zed", path: "src/components/app.tsx" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/projects/project%20one/open-capabilities");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/v1/projects/project%20one/open?rootPath=%2Fworkspace%2FCodexly",
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ appId: "zed", path: "src/components/app.tsx" }),
      method: "POST",
    });
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("idempotency-key")).toBe(
      "open-project-key",
    );
  });

  it("opens a task attachment with the host system application", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(
      jsonResponse({ attachmentId: "attachment/file-1", status: "opened" }),
    );
    const client = new CodexlyClient({ fetch: fetchMock });

    await expect(
      client.openTaskAttachment("project one", "task/1", "attachment/file-1", {
        idempotencyKey: "open-attachment-key",
      }),
    ).resolves.toEqual({ attachmentId: "attachment/file-1", status: "opened" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/projects/project%20one/tasks/task%2F1/attachments/attachment%2Ffile-1/open",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ body: "{}", method: "POST" });
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("idempotency-key")).toBe(
      "open-attachment-key",
    );
  });

  it("persists and validates a complete project order", async () => {
    const orderedProjects = [
      {
        createdAt: "2026-07-23T00:00:00.000Z",
        id: "superwork",
        name: "superwork",
        roots: [{ id: "root-superwork", path: "/workspace/superwork" }],
      },
    ];
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse({ data: orderedProjects, nextCursor: null }));
    const client = new CodexlyClient({ fetch: fetchMock });

    await expect(
      client.reorderProjects(["superwork"], { idempotencyKey: "project-order-key" }),
    ).resolves.toEqual({ data: orderedProjects, nextCursor: null });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/projects/order");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({ projectIds: ["superwork"] }),
      method: "PUT",
    });
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("idempotency-key")).toBe(
      "project-order-key",
    );
  });

  it("builds task pagination requests and validates successful responses", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse({ data: [task], nextCursor: null }));
    const client = new CodexlyClient({ fetch: fetchMock });

    await expect(
      client.listTasks("project one", {
        archived: true,
        cursor: "next/value",
        limit: 25,
        searchTerm: "归档 task",
      }),
    ).resolves.toEqual({ data: [task], nextCursor: null });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/projects/project%20one/tasks?archived=true&cursor=next%2Fvalue&limit=25&searchTerm=%E5%BD%92%E6%A1%A3+task",
    );
  });

  it("builds a paginated task snapshot request", async () => {
    const response = {
      checkpoint: { sequence: 0, sessionId: "runtime-1" },
      snapshot: {
        ...task,
        contextUsage: null,
        pendingRequests: [],
        plan: null,
        settings: taskSettings,
        status: "idle" as const,
        turns: [],
        turnsNextCursor: null,
      },
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse(response));
    const client = new CodexlyClient({ fetch: fetchMock });

    await expect(
      client.readTask("project one", "task-1", { cursor: "older/page" }),
    ).resolves.toEqual(response);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/projects/project%20one/tasks/task-1?cursor=older%2Fpage",
    );
  });

  it("uses the public temporary scope without exposing an internal Project route", async () => {
    const temporaryTask = { ...task, projectId: "temporary" };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: [temporaryTask], nextCursor: null }))
      .mockResolvedValueOnce(jsonResponse({ task: temporaryTask }));
    const client = new CodexlyClient({ fetch: fetchMock });

    await client.listTasks("temporary");
    await client.startTask("temporary", { idempotencyKey: "temporary-task" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/temporary/tasks");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/v1/temporary/tasks");
  });
});
