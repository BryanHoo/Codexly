import { describe, expect, it } from "vitest";

import "../router.js";
import { projectDraftRoute } from "./project-draft-route.js";
import { projectTaskBoardRoute, temporaryTaskBoardRoute } from "./task-board-route.js";

describe("task board routes", () => {
  it("为项目、临时作用域和待办提供稳定路径", () => {
    expect(projectTaskBoardRoute.fullPath).toBe("/p/$projectId/board");
    expect(temporaryTaskBoardRoute.fullPath).toBe("/temporary/board");
    expect(projectDraftRoute.fullPath).toBe("/p/$projectId/todo/$draftId");
  });
});
