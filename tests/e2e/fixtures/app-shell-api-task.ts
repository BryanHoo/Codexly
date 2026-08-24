import type { Route } from "@playwright/test";
import { taskSnapshot, taskSnapshotResponse } from "./app-shell-data.js";
import { isRequestRecord, parseRequestRecord } from "./app-shell-request.js";
import type { AppShellApiState, FixtureQueuedSubmission } from "./app-shell-api-state.js";

// 按协议领域处理一段 API 路由；未命中时交给下一处理器。
export async function handleAppShellTaskRoute(
  route: Route,
  state: AppShellApiState,
): Promise<boolean> {
  const url = new URL(route.request().url());
  const pinMatch = /^\/v1\/projects\/([^/]+)\/tasks\/([^/]+)\/pin$/u.exec(url.pathname);
  const renameMatch = /^\/v1\/projects\/([^/]+)\/tasks\/([^/]+)\/rename$/u.exec(url.pathname);
  const archiveMatch = /^\/v1\/projects\/([^/]+)\/tasks\/([^/]+)\/archive$/u.exec(url.pathname);
  const deleteMatch = /^\/v1\/projects\/([^/]+)\/tasks\/([^/]+)$/u.exec(url.pathname);
  const queueMatch = /^\/v1\/projects\/([^/]+)\/tasks\/([^/]+)\/queue$/u.exec(url.pathname);
  const queueItemMatch = /^\/v1\/projects\/([^/]+)\/tasks\/([^/]+)\/queue\/([^/]+)$/u.exec(
    url.pathname,
  );
  const queueReorderMatch = /^\/v1\/projects\/([^/]+)\/tasks\/([^/]+)\/queue\/reorder$/u.exec(
    url.pathname,
  );
  const queueStartMatch = /^\/v1\/projects\/([^/]+)\/tasks\/([^/]+)\/queue\/start$/u.exec(
    url.pathname,
  );
  let body: unknown;
  if (queueMatch !== null) {
    const taskKey = `${queueMatch[1] ?? ""}:${queueMatch[2] ?? ""}`;
    const queue = state.queuedSubmissionsByTask.get(taskKey) ?? [];
    if (route.request().method() === "POST") {
      const request = parseRequestRecord(route.request().postData());
      const input = request["input"];
      const clientUserMessageId = request["clientUserMessageId"];
      if (!isRequestRecord(input) || typeof clientUserMessageId !== "string") {
        throw new Error("Invalid queue add request");
      }
      const attachmentReferences = input["attachments"];
      const skillReferences = input["skills"];
      if (!Array.isArray(attachmentReferences) || !Array.isArray(skillReferences)) {
        throw new Error("Invalid queued input");
      }
      const queuedSubmission: FixtureQueuedSubmission = {
        attachments: attachmentReferences.map((reference) => {
          if (!isRequestRecord(reference) || typeof reference["id"] !== "string") {
            throw new Error("Invalid queued attachment");
          }
          return {
            id: reference["id"],
            kind: "file",
            mediaType: "text/plain",
            name: reference["id"],
            size: 1,
          };
        }),
        clientUserMessageId,
        id: `fixture-queue-${String(state.nextQueuedSubmission)}`,
        skills: skillReferences.map((reference) => {
          if (
            !isRequestRecord(reference) ||
            typeof reference["id"] !== "string" ||
            typeof reference["name"] !== "string"
          ) {
            throw new Error("Invalid queued Skill");
          }
          return { id: reference["id"], name: reference["name"] };
        }),
        text: typeof input["text"] === "string" ? input["text"] : "",
      };
      state.nextQueuedSubmission += 1;
      queue.push(queuedSubmission);
      state.queuedSubmissionsByTask.set(taskKey, queue);
      body = { queuedSubmission };
    } else {
      const limit = Number(url.searchParams.get("limit") ?? "100");
      const offset = Number(url.searchParams.get("cursor") ?? "0");
      const nextOffset = offset + limit;
      body = {
        data: queue.slice(offset, nextOffset),
        nextCursor: nextOffset < queue.length ? String(nextOffset) : null,
      };
    }
  } else if (queueReorderMatch !== null && route.request().method() === "PUT") {
    const taskKey = `${queueReorderMatch[1] ?? ""}:${queueReorderMatch[2] ?? ""}`;
    const request = parseRequestRecord(route.request().postData());
    const ids = request["queuedSubmissionIds"];
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
      throw new Error("Invalid queue reorder request");
    }
    const byId = new Map(
      (state.queuedSubmissionsByTask.get(taskKey) ?? []).map((submission) => [
        submission.id,
        submission,
      ]),
    );
    state.queuedSubmissionsByTask.set(
      taskKey,
      ids.flatMap((id) => byId.get(id) ?? []),
    );
    body = { status: "reordered" };
  } else if (queueStartMatch !== null && route.request().method() === "POST") {
    const taskKey = `${queueStartMatch[1] ?? ""}:${queueStartMatch[2] ?? ""}`;
    const queue = state.queuedSubmissionsByTask.get(taskKey) ?? [];
    const request = parseRequestRecord(route.request().postData());
    const requestedId = request["queuedSubmissionId"];
    const index =
      typeof requestedId === "string"
        ? queue.findIndex((submission) => submission.id === requestedId)
        : 0;
    if (index >= 0) {
      queue.splice(index, 1);
    }
    body = {
      taskId: queueStartMatch[2] ?? "",
      turn: {
        completedAt: null,
        error: null,
        id: `fixture-queue-turn-${String(state.nextQueuedSubmission)}`,
        items: [],
        startedAt: "2026-08-21T00:00:00.000Z",
        status: "running",
      },
    };
  } else if (queueItemMatch !== null) {
    const taskKey = `${queueItemMatch[1] ?? ""}:${queueItemMatch[2] ?? ""}`;
    const queuedSubmissionId = queueItemMatch[3] ?? "";
    const queue = state.queuedSubmissionsByTask.get(taskKey) ?? [];
    const index = queue.findIndex((submission) => submission.id === queuedSubmissionId);
    if (route.request().method() === "DELETE") {
      const deleted = index >= 0;
      if (deleted) {
        queue.splice(index, 1);
      }
      body = { deleted };
    } else {
      const current = queue[index];
      const request = parseRequestRecord(route.request().postData());
      const input = request["input"];
      if (current === undefined || !isRequestRecord(input) || typeof input["text"] !== "string") {
        throw new Error("Invalid queue update request");
      }
      const queuedSubmission = { ...current, text: input["text"] };
      queue[index] = queuedSubmission;
      body = { queuedSubmission };
    }
  } else if (pinMatch !== null) {
    const taskId = pinMatch[2] ?? "";
    const request = parseRequestRecord(route.request().postData());
    const pinned = request["pinned"];
    const task = state.routedTasks.find((item) => item.id === taskId);
    if (task === undefined || typeof pinned !== "boolean") {
      throw new Error("Invalid pin task request");
    }
    task.pinned = pinned;
    body = { task };
  } else if (renameMatch !== null) {
    const taskId = renameMatch[2] ?? "";
    const request = parseRequestRecord(route.request().postData());
    const title = request["title"];
    const task = state.routedTasks.find((item) => item.id === taskId);
    if (task === undefined || typeof title !== "string") {
      throw new Error("Invalid rename task request");
    }
    task.title = title;
    body = { task };
  } else if (archiveMatch !== null) {
    const taskId = archiveMatch[2] ?? "";
    state.routedTasks = state.routedTasks.filter((item) => item.id !== taskId);
    body = { status: "archived", taskId };
  } else if (deleteMatch !== null && route.request().method() === "DELETE") {
    const taskId = deleteMatch[2] ?? "";
    state.routedTasks = state.routedTasks.filter((item) => item.id !== taskId);
    body = { status: "deleted", taskId };
  } else if (url.pathname.endsWith("/background-terminals")) {
    body = { data: [], nextCursor: null };
  } else if (url.pathname.startsWith("/v1/projects/") && url.pathname.endsWith("/tasks")) {
    const projectId = url.pathname.split("/")[3];
    const projectTasks = state.routedTasks.filter(
      (task) =>
        task.projectId === projectId && (url.searchParams.get("pinned") !== "true" || task.pinned),
    );
    const pageLimit = Number(url.searchParams.get("limit") ?? "5");
    const pageOffset = Number(url.searchParams.get("cursor") ?? "0");
    const nextOffset = pageOffset + pageLimit;
    // 测试服务按真实 Cursor 契约分页，避免首屏测试意外读取全部任务。
    body = {
      data: projectTasks.slice(pageOffset, nextOffset),
      nextCursor: nextOffset < projectTasks.length ? String(nextOffset) : null,
    };
  } else if (url.pathname === "/v1/projects/codexly/tasks/task-1") {
    body = {
      ...taskSnapshotResponse,
      snapshot: {
        ...taskSnapshotResponse.snapshot,
        settings: state.taskSettings.get("codexly:task-1") ?? taskSnapshot.settings,
      },
    };
  } else if (url.pathname === "/v1/projects/codexly/tasks/task-2") {
    body = {
      ...taskSnapshotResponse,
      snapshot: {
        ...taskSnapshotResponse.snapshot,
        id: "task-2",
        settings: state.taskSettings.get("codexly:task-2") ?? taskSnapshot.settings,
        title: "续接任务",
      },
    };
  } else if (url.pathname === "/v1/projects/codexly/tasks/task-1/compact") {
    body = { status: "compacting", taskId: "task-1" };
  } else if (url.pathname === "/v1/projects/codexly/tasks/task-1/review") {
    body = {
      taskId: "task-1",
      turn: {
        completedAt: null,
        error: null,
        id: "review-turn",
        items: [],
        startedAt: "2026-07-29T00:00:00.000Z",
        status: "running",
      },
    };
  } else if (url.pathname === "/v1/projects/codexly/tasks/task-1/fork") {
    body = {
      task: {
        id: "task-2",
        pinned: false,
        projectId: "codexly",
        title: "续接任务",
        updatedAt: "2026-07-25T00:00:00.000Z",
      },
    };
  } else {
    return false;
  }
  await route.fulfill({ contentType: "application/json", json: body });
  return true;
}
