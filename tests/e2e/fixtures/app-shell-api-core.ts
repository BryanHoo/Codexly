import type { Route } from "@playwright/test";
import {
  customModels,
  mcpServers,
  projectDirectoryListings,
  skills,
  taskSnapshot,
} from "./app-shell-data.js";
import {
  isRequestRecord,
  parseGlobalSettingsRequest,
  parseProjectOrderRequest,
  parseRequestRecord,
  parseTaskSettingsRequest,
} from "./app-shell-request.js";
import type { AppShellApiState } from "./app-shell-api-state.js";

// 按协议领域处理一段 API 路由；未命中时交给下一处理器。
export async function handleAppShellCoreRoute(
  route: Route,
  state: AppShellApiState,
): Promise<boolean> {
  const url = new URL(route.request().url());
  const temporarySettingsMatch = /^\/v1\/temporary\/tasks\/([^/]+)\/settings$/u.exec(url.pathname);
  const temporaryPinMatch = /^\/v1\/temporary\/tasks\/([^/]+)\/pin$/u.exec(url.pathname);
  const temporaryRenameMatch = /^\/v1\/temporary\/tasks\/([^/]+)\/rename$/u.exec(url.pathname);
  const temporaryArchiveMatch = /^\/v1\/temporary\/tasks\/([^/]+)\/archive$/u.exec(url.pathname);
  const temporaryTaskMatch = /^\/v1\/temporary\/tasks\/([^/]+)$/u.exec(url.pathname);
  const temporaryTurnMatch = /^\/v1\/temporary\/tasks\/([^/]+)\/turns$/u.exec(url.pathname);
  if (
    url.pathname === "/v1/projects/codexly/files/image" ||
    url.pathname === "/v1/temporary/files/image"
  ) {
    await route.fulfill({
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
      contentType: "image/png",
    });
    return true;
  }
  if (
    (/^\/v1\/projects\/[^/]+\/attachments\/[^/]+$/u.test(url.pathname) ||
      /^\/v1\/temporary\/attachments\/[^/]+$/u.test(url.pathname)) &&
    route.request().method() === "GET"
  ) {
    await route.fulfill({
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
      contentType: "image/png",
    });
    return true;
  }
  let body: unknown;
  if (url.pathname === "/v1/access") {
    body = { authenticated: true, mode: "local", version: 1 };
  } else if (url.pathname === "/v1/health") {
    body = { status: "ok", version: 1 };
  } else if (url.pathname === "/v1/app-info") {
    body = {
      appVersion: "1.3.0",
      codexVersion: "0.149.0",
      latestVersion: "1.3.0",
      releaseNotes: null,
      status: "current",
      updateAvailable: false,
    };
  } else if (url.pathname === "/v1/capabilities") {
    body = {
      feedback: { upload: true },
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
    };
  } else if (url.pathname === "/v1/provider-connection") {
    body = state.providerStatus;
  } else if (
    url.pathname === "/v1/provider-connection/custom" &&
    route.request().method() === "PUT"
  ) {
    const input = parseRequestRecord(route.request().postData());
    const baseUrl = input["baseUrl"];
    if (typeof baseUrl !== "string") {
      throw new Error("Invalid custom provider request");
    }
    state.routedModels = customModels;
    state.providerStatus = {
      account: input["apiKey"] === undefined ? null : { type: "apiKey" },
      customBaseUrl: baseUrl.replace(/\/+$/u, ""),
      mode: "custom",
      pendingLogin: null,
      state: "connected",
    };
    body = { models: { data: state.routedModels, nextCursor: null }, status: state.providerStatus };
  } else if (url.pathname === "/v1/provider-connection/official-login") {
    state.providerStatus = {
      account: null,
      customBaseUrl: null,
      mode: "official",
      pendingLogin: { error: null, loginId: "e2e-login", state: "pending" },
      state: "pending",
    };
    body = {
      authUrl: "https://auth.openai.com/authorize",
      loginId: "e2e-login",
      status: state.providerStatus,
    };
  } else if (url.pathname === "/v1/provider-connection/official-login/cancel") {
    state.providerStatus = {
      account: null,
      customBaseUrl: null,
      mode: "official",
      pendingLogin: null,
      state: "disconnected",
    };
    body = { status: state.providerStatus };
  } else if (url.pathname === "/v1/provider-connection/logout") {
    state.providerStatus = { ...state.providerStatus, account: null, state: "disconnected" };
    body = { status: state.providerStatus };
  } else if (url.pathname === "/v1/models") {
    body = { data: state.routedModels, nextCursor: null };
  } else if (url.pathname === "/v1/settings") {
    if (route.request().method() === "PUT") {
      state.globalSettings = parseGlobalSettingsRequest(route.request().postData());
    }
    body = { settings: state.globalSettings };
  } else if (url.pathname === "/v1/temporary/tasks" && route.request().method() === "POST") {
    const task = {
      id: `temporary-task-${String(state.temporaryTasks.length + 1)}`,
      pinned: false,
      projectId: "temporary",
      title: "临时任务会话",
      updatedAt: "2026-08-06T08:00:00.000Z",
    };
    state.temporaryTasks = [task, ...state.temporaryTasks];
    state.temporaryTurns.set(task.id, []);
    state.taskSettings.set(`temporary:${task.id}`, {
      approvalPolicy:
        state.globalSettings.approvalsReviewer === "auto_review"
          ? "on-request"
          : state.globalSettings.approvalPolicy,
      approvalsReviewer: state.globalSettings.approvalsReviewer,
      model: state.globalSettings.model,
      reasoningEffort: state.globalSettings.reasoningEffort,
      sandboxMode: state.globalSettings.sandboxMode,
    });
    body = { task };
  } else if (url.pathname === "/v1/temporary/tasks") {
    const visibleTemporaryTasks =
      url.searchParams.get("pinned") === "true"
        ? state.temporaryTasks.filter((task) => task.pinned)
        : state.temporaryTasks;
    const pageLimit = Number(url.searchParams.get("limit") ?? "5");
    const pageOffset = Number(url.searchParams.get("cursor") ?? "0");
    const nextOffset = pageOffset + pageLimit;
    body = {
      data: visibleTemporaryTasks.slice(pageOffset, nextOffset),
      nextCursor: nextOffset < visibleTemporaryTasks.length ? String(nextOffset) : null,
    };
  } else if (temporarySettingsMatch !== null) {
    const taskId = temporarySettingsMatch[1] ?? "";
    const key = `temporary:${taskId}`;
    if (route.request().method() === "PUT") {
      state.taskSettings.set(key, parseTaskSettingsRequest(route.request().postData()));
    }
    body = { settings: state.taskSettings.get(key) ?? taskSnapshot.settings };
  } else if (temporaryPinMatch !== null) {
    const taskId = temporaryPinMatch[1] ?? "";
    const request = parseRequestRecord(route.request().postData());
    const pinned = request["pinned"];
    const task = state.temporaryTasks.find((item) => item.id === taskId);
    if (task === undefined || typeof pinned !== "boolean") {
      throw new Error("Invalid temporary pin request");
    }
    task.pinned = pinned;
    body = { task };
  } else if (temporaryRenameMatch !== null) {
    const taskId = temporaryRenameMatch[1] ?? "";
    const request = parseRequestRecord(route.request().postData());
    const title = request["title"];
    const task = state.temporaryTasks.find((item) => item.id === taskId);
    if (task === undefined || typeof title !== "string") {
      throw new Error("Invalid temporary rename request");
    }
    task.title = title;
    body = { task };
  } else if (temporaryArchiveMatch !== null) {
    const taskId = temporaryArchiveMatch[1] ?? "";
    state.temporaryTasks = state.temporaryTasks.filter((item) => item.id !== taskId);
    state.temporaryTurns.delete(taskId);
    body = { status: "archived", taskId };
  } else if (temporaryTaskMatch !== null && route.request().method() === "DELETE") {
    const taskId = temporaryTaskMatch[1] ?? "";
    state.temporaryTasks = state.temporaryTasks.filter((item) => item.id !== taskId);
    state.temporaryTurns.delete(taskId);
    body = { status: "deleted", taskId };
  } else if (temporaryTurnMatch !== null && route.request().method() === "POST") {
    const taskId = temporaryTurnMatch[1] ?? "";
    const task = state.temporaryTasks.find((item) => item.id === taskId);
    const request = parseRequestRecord(route.request().postData());
    const input = request["input"];
    const options = request["options"];
    if (
      task === undefined ||
      !isRequestRecord(input) ||
      typeof input["text"] !== "string" ||
      !isRequestRecord(options)
    ) {
      throw new Error("Invalid temporary turn request");
    }
    // 真实 Server 会在启动 Turn 前保存完整设置，刷新后的 Snapshot 必须复现该行为。
    state.taskSettings.set(
      `temporary:${taskId}`,
      parseTaskSettingsRequest(JSON.stringify(options)),
    );
    const turnNumber = (state.temporaryTurns.get(taskId)?.length ?? 0) + 1;
    const turn = {
      completedAt: `2026-08-06T08:0${String(turnNumber)}:30.000Z`,
      error: null,
      id: `temporary-turn-${String(turnNumber)}`,
      items: [
        {
          id: `temporary-user-${String(turnNumber)}`,
          role: "user" as const,
          text: input["text"],
          type: "message" as const,
        },
        {
          changes: [
            {
              diff: "--- a/temporary-change.ts\n+++ b/temporary-change.ts\n@@ -1 +1 @@\n-old\n+new",
              kind: "update" as const,
              path: "/tmp/temporary-change.ts",
            },
          ],
          id: `temporary-file-change-${String(turnNumber)}`,
          status: "completed" as const,
          type: "file_change" as const,
        },
        {
          id: `temporary-assistant-${String(turnNumber)}`,
          role: "assistant" as const,
          text: `临时回复：${input["text"]}\n\n[temporary-note.md](/tmp/temporary-note.md)\n\n[temporary-preview.png](/tmp/temporary-preview.png)\n\n[temporary-report.pdf](/tmp/temporary-report.pdf)`,
          type: "message" as const,
        },
      ],
      startedAt: `2026-08-06T08:0${String(turnNumber)}:00.000Z`,
      status: "completed" as const,
    };
    state.temporaryTurns.set(taskId, [...(state.temporaryTurns.get(taskId) ?? []), turn]);
    body = { taskId, turn };
  } else if (temporaryTaskMatch !== null) {
    const taskId = temporaryTaskMatch[1] ?? "";
    const task = state.temporaryTasks.find((item) => item.id === taskId);
    if (task === undefined) {
      await route.fulfill({
        contentType: "application/json",
        json: { message: "Not found" },
        status: 404,
      });
      return true;
    }
    body = {
      checkpoint: { sequence: 0, sessionId: "e2e-session" },
      snapshot: {
        ...task,
        contextUsage: { contextWindow: 200_000, usedTokens: 1_000 },
        plan: null,
        pendingRequests: [],
        settings: state.taskSettings.get(`temporary:${taskId}`) ?? taskSnapshot.settings,
        status: "idle",
        turns: state.temporaryTurns.get(taskId) ?? [],
        turnsNextCursor: null,
      },
    };
  } else if (url.pathname === "/v1/temporary/skills") {
    body = { data: skills, nextCursor: null };
  } else if (
    /^\/v1\/(?:temporary|projects\/[^/]+)\/tasks\/[^/]+\/mcp-servers\/retry$/u.test(url.pathname) &&
    route.request().method() === "POST"
  ) {
    body = {
      data: mcpServers.map((server) => ({
        ...server,
        authStatus: null,
        status: "starting",
        toolCount: 0,
        version: null,
      })),
    };
  } else if (/^\/v1\/temporary\/tasks\/[^/]+\/mcp-servers$/u.test(url.pathname)) {
    body = { data: mcpServers };
  } else if (/^\/v1\/projects\/[^/]+\/skills$/u.test(url.pathname)) {
    body = { data: skills, nextCursor: null };
  } else if (/^\/v1\/projects\/[^/]+\/tasks\/[^/]+\/mcp-servers$/u.test(url.pathname)) {
    body = { data: mcpServers };
  } else if (/^\/v1\/(?:temporary|projects\/[^/]+)\/open-capabilities$/u.test(url.pathname)) {
    body = {
      apps: [
        { id: "zed", kind: "editor", name: "Zed" },
        { id: "system-default", kind: "system-default", name: "__SYSTEM_DEFAULT__" },
        { id: "finder", kind: "file-manager", name: "Finder" },
        { id: "terminal", kind: "terminal", name: "Terminal" },
      ],
      platform: "darwin",
    };
  } else if (
    /^\/v1\/(?:temporary|projects\/[^/]+)\/open$/u.test(url.pathname) &&
    route.request().method() === "POST"
  ) {
    const request = parseRequestRecord(route.request().postData());
    body = {
      appId: request["appId"],
      ...(typeof request["path"] === "string" ? { path: request["path"] } : {}),
    };
  } else if (url.pathname === "/v1/projects/order" && route.request().method() === "PUT") {
    const projectIds = parseProjectOrderRequest(route.request().postData());
    state.routedProjects = projectIds.map((projectId) => {
      const project = state.routedProjects.find((item) => item.id === projectId);
      if (project === undefined) {
        throw new Error("Unknown project in order request");
      }
      return project;
    });
    body = { data: state.routedProjects, nextCursor: null };
  } else if (url.pathname === "/v1/host-files") {
    const kind = url.searchParams.get("kind");
    const requestedPath = url.searchParams.get("path") ?? "/Users/bryan/Attachments";
    const includeHidden = url.searchParams.get("includeHidden") === "true";
    const visibleFileNames =
      requestedPath === "/Users/bryan/HiddenDocs"
        ? ["notes.pdf"]
        : kind === "image"
          ? ["draft.png", "preserved.png", "screen.png", "task-draft.png"]
          : ["specification.pdf"];
    // 仅在显式查询时返回点号文件，保持 fixture 与宿主浏览接口的默认行为一致。
    const fileNames = includeHidden
      ? [`.secret.${kind === "image" ? "png" : "pdf"}`, ...visibleFileNames]
      : visibleFileNames;
    const parentPath = requestedPath.split("/").slice(0, -1).join("/") || "/";
    body = {
      entries: fileNames.map((name) => ({
        name,
        path: `${requestedPath}/${name}`,
        type: "file",
      })),
      parentPath,
      path: requestedPath,
      roots: [],
    };
  } else if (
    /^\/v1\/projects\/[^/]+\/attachments\/(file|image)\/host$/u.test(url.pathname) &&
    route.request().method() === "POST"
  ) {
    const kind = url.pathname.includes("/attachments/image/") ? "image" : "file";
    const request = parseRequestRecord(route.request().postData());
    const path = request["path"];
    if (typeof path !== "string") {
      throw new Error("Invalid host attachment request");
    }
    const name = path.split("/").at(-1) ?? "attachment";
    body = {
      attachment: {
        id: `attachment-host-${name}`,
        kind,
        mediaType: kind === "image" ? "image/png" : "application/pdf",
        name,
        size: kind === "image" ? 68 : 8,
      },
    };
  } else if (url.pathname === "/v1/project-directories") {
    const path = url.searchParams.get("path");
    const listing = projectDirectoryListings.get(path);
    body =
      path === "/workspace/ProjectVault" && url.searchParams.get("includeHidden") === "true"
        ? {
            entries: [
              { name: ".HiddenProject", path: "/workspace/ProjectVault/.HiddenProject" },
              { name: "VisibleProject", path: "/workspace/ProjectVault/VisibleProject" },
            ],
            parentPath: "/workspace",
            path,
            roots: [],
          }
        : (listing ?? ({ entries: [], parentPath: "/workspace", path, roots: [] } as const));
  } else if (url.pathname === "/v1/projects" && route.request().method() === "POST") {
    const request = parseRequestRecord(route.request().postData());
    const roots = request["roots"];
    if (
      !Array.isArray(roots) ||
      roots.length !== 2 ||
      !isRequestRecord(roots[0]) ||
      !isRequestRecord(roots[1]) ||
      roots[0]["path"] !== "/workspace/AddedProject" ||
      roots[1]["path"] !== "/workspace/superwork"
    ) {
      throw new Error("Invalid add project request");
    }
    const addedProject = {
      createdAt: "2026-07-25T00:00:00.000Z",
      id: "added-project",
      name: "AddedProject",
      roots: [
        { id: "root-added-project", path: "/workspace/AddedProject" },
        { id: "root-superwork", path: "/workspace/superwork" },
      ],
    };
    state.routedProjects = [...state.routedProjects, addedProject];
    body = { project: addedProject };
  } else {
    return false;
  }
  await route.fulfill({ contentType: "application/json", json: body });
  return true;
}
