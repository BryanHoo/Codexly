import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ClaudeQueueRepository } from "./queue-repository.js";

it("restores rejected desktop queue claims without clearing accepted input", async ({
  onTestFinished,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "codexly-queue-rejection-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const repository = new ClaudeQueueRepository(directory);
  const record = await repository.addQueue({
    clientUserMessageId: "message",
    id: "queue",
    projectId: "temporary",
    taskId: "task",
    status: "queued",
    input: { attachments: [], skills: [], text: "Run", type: "prompt" },
  });
  expect(await repository.setQueueExecution(record, { state: "starting" })).toBe(true);
  expect(await repository.setQueueExecution(record, null)).toBe(true);
  const reopened = new ClaudeQueueRepository(directory);
  expect((await reopened.listQueue("temporary", "task"))[0]?.execution).toBeUndefined();
  expect(await reopened.setQueueExecution(record, { state: "starting" })).toBe(true);
  const execution = {
    state: "started" as const,
    turn: {
      id: "accepted-turn",
      status: "running" as const,
      items: [],
      error: null,
      startedAt: null,
      completedAt: null,
    },
  };
  await reopened.setQueueExecution(record, execution);
  expect(await reopened.setQueueExecution(record, null)).toBe(false);
  expect((await reopened.listQueue("temporary", "task"))[0]?.execution).toEqual(execution);
});
