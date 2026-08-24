import type { Route } from "@playwright/test";
import {
  architectureSourceFirstPage,
  architectureSourceNextCursor,
  architectureSourceSecondPage,
  projectFileSearchEntries,
  projectFileTreeByDirectory,
  taskSnapshot,
} from "./app-shell-data.js";
import {
  parseProjectDefaultsRequest,
  parseRequestRecord,
  parseTaskSettingsRequest,
} from "./app-shell-request.js";
import type { AppShellApiState } from "./app-shell-api-state.js";

// 按协议领域处理一段 API 路由；未命中时交给下一处理器。
export async function handleAppShellProjectRoute(
  route: Route,
  state: AppShellApiState,
): Promise<boolean> {
  const url = new URL(route.request().url());
  const defaultsMatch = /^\/v1\/projects\/([^/]+)\/defaults$/u.exec(url.pathname);
  const settingsMatch = /^\/v1\/projects\/([^/]+)\/tasks\/([^/]+)\/settings$/u.exec(url.pathname);
  const projectRenameMatch = /^\/v1\/projects\/([^/]+)\/rename$/u.exec(url.pathname);
  const projectRemoveMatch = /^\/v1\/projects\/([^/]+)\/remove$/u.exec(url.pathname);
  let body: unknown;
  if (projectRenameMatch !== null && route.request().method() === "POST") {
    const projectId = projectRenameMatch[1] ?? "";
    const request = parseRequestRecord(route.request().postData());
    const name = request["name"];
    const projectIndex = state.routedProjects.findIndex((project) => project.id === projectId);
    const project = state.routedProjects[projectIndex];
    if (project === undefined || typeof name !== "string") {
      throw new Error("Invalid rename project request");
    }
    const renamedProject = { ...project, name };
    state.routedProjects[projectIndex] = renamedProject;
    body = { project: renamedProject };
  } else if (projectRemoveMatch !== null && route.request().method() === "POST") {
    const projectId = projectRemoveMatch[1] ?? "";
    state.routedProjects = state.routedProjects.filter((project) => project.id !== projectId);
    body = { projectId, status: "removed" };
  } else if (url.pathname === "/v1/projects") {
    body = { data: state.routedProjects, nextCursor: null };
  } else if (
    /^\/v1\/projects\/[^/]+\/files\/search\/stop$/u.test(url.pathname) &&
    route.request().method() === "POST"
  ) {
    body = {};
  } else if (/^\/v1\/projects\/[^/]+\/files\/search$/u.test(url.pathname)) {
    const query = (url.searchParams.get("query") ?? "").toLocaleLowerCase();
    body = {
      data: projectFileSearchEntries.filter((file) =>
        file.name.toLocaleLowerCase().includes(query),
      ),
    };
  } else if (/^\/v1\/projects\/[^/]+\/files\/tree$/u.test(url.pathname)) {
    const directoryPath = url.searchParams.get("path");
    // 文件树接口只返回当前目录的直接子项，用于验证点击目录后才按需加载。
    body = projectFileTreeByDirectory.get(directoryPath) ?? { entries: [], path: directoryPath };
  } else if (url.pathname === "/v1/temporary/files/source") {
    body = {
      content: "# 临时文件\n\n允许从临时任务打开。\n",
      nextCursor: null,
      path: "/tmp/temporary-note.md",
    };
  } else if (url.pathname === "/v1/projects/code-agent/files/source") {
    body =
      url.searchParams.get("cursor") === String(architectureSourceNextCursor)
        ? {
            content: architectureSourceSecondPage,
            nextCursor: null,
            path: "docs/architecture-design.md",
          }
        : {
            content: architectureSourceFirstPage,
            nextCursor: architectureSourceNextCursor,
            path: "docs/architecture-design.md",
          };
  } else if (
    url.pathname === "/v1/projects/code-agent/git/worktrees" &&
    route.request().method() === "GET"
  ) {
    body = { worktrees: state.routedProjectGitWorktrees };
  } else if (
    url.pathname === "/v1/projects/code-agent/git/worktrees" &&
    route.request().method() === "POST"
  ) {
    const request = parseRequestRecord(route.request().postData());
    const branch = request["branch"];
    if (
      typeof branch !== "string" ||
      request["expectedSnapshot"] !== state.routedProjectGitStatus.snapshot
    ) {
      throw new Error("Invalid worktree creation request");
    }
    const worktree = {
      branch,
      current: false,
      path: "/workspace/CodeAgent-composer-worktree",
    };
    const project = {
      createdAt: "2026-08-18T00:00:00.000Z",
      id: "code-agent-composer-worktree",
      name: "CodeAgent-composer-worktree",
      roots: [{ id: "root-code-agent-composer-worktree", path: worktree.path }],
    };
    state.routedProjectGitWorktrees.push(worktree);
    state.routedProjects = [...state.routedProjects, project];
    body = { project, worktree };
  } else if (
    url.pathname === "/v1/projects/code-agent/git/worktree" &&
    route.request().method() === "POST"
  ) {
    const request = parseRequestRecord(route.request().postData());
    const worktree = state.routedProjectGitWorktrees.find(
      (candidate) => candidate.path === request["path"] && !candidate.current,
    );
    if (worktree === undefined) throw new Error("Invalid worktree switch request");
    const project = {
      createdAt: "2026-08-18T00:00:00.000Z",
      id: "code-agent-worktree-review",
      name: "CodeAgent-worktree-review",
      roots: [{ id: "root-code-agent-worktree-review", path: worktree.path }],
    };
    if (!state.routedProjects.some((candidate) => candidate.id === project.id)) {
      state.routedProjects = [...state.routedProjects, project];
    }
    body = { project, worktree };
  } else if (
    url.pathname === "/v1/projects/code-agent/git/branch" &&
    route.request().method() === "POST"
  ) {
    const request = parseRequestRecord(route.request().postData());
    const branch = request["branch"];
    if (
      typeof branch !== "string" ||
      request["expectedSnapshot"] !== state.routedProjectGitStatus.snapshot ||
      !state.routedProjectGitStatus.branches.includes(branch)
    ) {
      throw new Error("Invalid branch switch request");
    }
    const previousBranch = state.routedProjectGitStatus.branch;
    state.routedProjectGitStatus = {
      ...state.routedProjectGitStatus,
      baseBranches: [
        ...state.routedProjectGitStatus.baseBranches.filter((candidate) => candidate !== branch),
        previousBranch,
      ],
      branch,
      branches: [
        branch,
        ...state.routedProjectGitStatus.branches.filter((candidate) => candidate !== branch),
      ],
      snapshot: "b".repeat(64),
    };
    body = state.routedProjectGitStatus;
  } else if (
    url.pathname === "/v1/projects/code-agent/git/branches" &&
    route.request().method() === "POST"
  ) {
    const request = parseRequestRecord(route.request().postData());
    const branch = request["branch"];
    if (
      typeof branch !== "string" ||
      request["expectedSnapshot"] !== state.routedProjectGitStatus.snapshot ||
      state.routedProjectGitStatus.branches.includes(branch)
    ) {
      throw new Error("Invalid branch creation request");
    }
    const previousBranch = state.routedProjectGitStatus.branch;
    state.routedProjectGitStatus = {
      ...state.routedProjectGitStatus,
      baseBranches: [...state.routedProjectGitStatus.baseBranches, previousBranch],
      branch,
      branches: [branch, ...state.routedProjectGitStatus.branches],
      snapshot: "c".repeat(64),
    };
    body = state.routedProjectGitStatus;
  } else if (/^\/v1\/projects\/[^/]+\/git\/status$/u.test(url.pathname)) {
    body =
      url.searchParams.get("rootPath") === "/workspace/shared"
        ? { ...state.routedProjectGitStatus, branch: "shared-main" }
        : state.routedProjectGitStatus;
  } else if (defaultsMatch !== null) {
    const projectId = defaultsMatch[1] ?? "";
    if (route.request().method() === "PUT") {
      state.projectDefaults.set(projectId, parseProjectDefaultsRequest(route.request().postData()));
    }
    body = { settings: state.projectDefaults.get(projectId) };
  } else if (settingsMatch !== null) {
    const projectId = settingsMatch[1] ?? "";
    const taskId = settingsMatch[2] ?? "";
    const key = `${projectId}:${taskId}`;
    if (route.request().method() === "PUT") {
      state.taskSettings.set(key, parseTaskSettingsRequest(route.request().postData()));
    }
    body = { settings: state.taskSettings.get(key) ?? taskSnapshot.settings };
  } else {
    return false;
  }
  await route.fulfill({ contentType: "application/json", json: body });
  return true;
}
