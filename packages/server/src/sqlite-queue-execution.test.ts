import { describe, expect, it } from "vitest";
import {
  createWorkspace,
  openRepository,
  repositories,
} from "./sqlite-state-repository.test-support.js";

describe("SQLite queue execution", () => {
  it("persists an atomic claim and its launch result across restarts", async () => {
    const root = await createWorkspace();
    const repository = await openRepository(root);
    const record = await repository.addQueue({
      clientUserMessageId: "message",
      id: "queue",
      projectId: "temporary",
      taskId: "task",
      status: "queued",
      input: { attachments: [], skills: [], text: "Run", type: "prompt" },
    });
    expect(await repository.setQueueExecution(record, { state: "starting" })).toBe(true);
    expect(await repository.setQueueExecution(record, { state: "starting" })).toBe(false);
    await repository.close();
    repositories.splice(repositories.indexOf(repository), 1);
    const reopened = await openRepository(root);
    expect((await reopened.listQueue("temporary", "task"))[0]?.execution).toEqual({
      state: "starting",
    });
    const execution = {
      state: "started" as const,
      turn: {
        id: "turn",
        status: "running" as const,
        items: [],
        error: null,
        startedAt: null,
        completedAt: null,
      },
    };
    expect(await reopened.setQueueExecution(record, execution)).toBe(true);
    await reopened.close();
    repositories.splice(repositories.indexOf(reopened), 1);
    const recovered = await openRepository(root);
    expect((await recovered.listQueue("temporary", "task"))[0]?.execution).toEqual(execution);
    expect(
      await recovered.updateQueue("temporary", "task", "queue", record.input, "queued"),
    ).toBeUndefined();
  });
});
