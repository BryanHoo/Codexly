import { describe, expect, it } from "vitest";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

describe("async question persistence", () => {
  const group = {
    id: "question-1",
    turnId: "turn-1",
    createdAt: "2026-09-12T00:00:00.000Z",
    questions: [{ title: "范围", options: null }],
    status: "pending" as const,
  };
  it("claims answers once and preserves terminal state across restart and rediscovery", async () => {
    const root = await createWorkspace();
    const repository = await openRepository(root);
    await repository.discoverAsyncQuestions("project-a", "task-1", [group]);
    const record = { group: { ...group, status: "answering" as const }, fingerprint: "answer" };
    const claims = await Promise.all([
      repository.updateAsyncQuestion("project-a", "task-1", record, "pending"),
      repository.updateAsyncQuestion("project-a", "task-1", record, "pending"),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await repository.dismissAsyncQuestions("project-a", "task-1", [group.id]);
    await repository.close();
    const reopened = await openRepository(root);
    await reopened.discoverAsyncQuestions("project-a", "task-1", [group]);
    expect(await reopened.listAsyncQuestions("project-a", "task-1")).toEqual([record]);
    expect(await reopened.listAsyncQuestions("other", "task-1")).toEqual([]);
  });
  it("dismisses only explicitly selected pending groups", async () => {
    const repository = await openRepository(await createWorkspace());
    await repository.discoverAsyncQuestions("project-a", "task-1", [
      group,
      { ...group, id: "new" },
    ]);
    await repository.dismissAsyncQuestions("project-a", "task-1", [group.id]);
    expect(
      (await repository.listAsyncQuestions("project-a", "task-1")).map((record) => [
        record.group.id,
        record.group.status,
      ]),
    ).toEqual([
      ["question-1", "dismissed"],
      ["new", "pending"],
    ]);
  });
});
