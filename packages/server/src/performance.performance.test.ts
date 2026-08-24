import { stat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import type { AgentEvent, EventStreamMessage } from "@codexly/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import performanceBudgets from "../../../tests/performance-budgets.json" with { type: "json" };
import { AgentEventStream } from "./agent-event-stream.js";
import { AttachmentStore } from "./attachment-store.js";
import {
  sendEventStreamEvents,
  sendEventStreamMessage,
  type EventStreamSocket,
} from "./event-socket-sender.js";
import { readGitWorkingTreeStatus } from "./git-working-tree.js";

const fixedTimestamp = "2026-08-02T00:00:00.000Z";
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

function collectHeap(): number {
  if (globalThis.gc === undefined) {
    throw new Error("Performance tests require explicit GC");
  }
  globalThis.gc();
  globalThis.gc();
  return process.memoryUsage().heapUsed;
}

function createDeltaEvent(delta = "x") {
  return {
    itemId: "item-performance",
    payload: { delta },
    taskId: "task-performance",
    turnId: "turn-performance",
    type: "message.delta",
  } as const;
}

function createGitDiffOutput(paths: readonly string[], replacement: string): string {
  const rawChanges = paths.map((path) => `:100644 100644 1111111 2222222 M\0${path}\0`).join("");
  const patches = paths
    .map(
      (path) =>
        `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+${replacement}\n`,
    )
    .join("");
  return `${rawChanges}\0${patches}`;
}

function exerciseEventStreamLifecycle(deltaCount: number): void {
  const stream = new AgentEventStream({ provider: "codex", sessionId: "session-heap" });
  for (let index = 0; index < deltaCount; index += 1) {
    stream.publish(createDeltaEvent());
  }
  stream.close();
}

describe("server performance acceptance", () => {
  it("coalesces 100,000 deltas under slow-client pressure within budget", () => {
    const stream = new AgentEventStream({
      now: () => new Date(fixedTimestamp),
      provider: "codex",
      sessionId: "session-performance",
    });
    const listener = vi.fn<(event: AgentEvent) => void>();
    stream.subscribe(listener);
    stream.noteBackpressure();

    const startedAt = performance.now();
    for (let index = 0; index < performanceBudgets.delta.serverEvents; index += 1) {
      stream.publish(createDeltaEvent());
    }
    const checkpoint = stream.checkpoint;
    const durationMs = performance.now() - startedAt;

    expect(checkpoint.sequence).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: { delta: "x".repeat(performanceBudgets.delta.serverEvents - 1) },
      }),
    );
    expect(stream.metrics).toMatchObject({
      backpressureSignals: 1,
      coalescedEvents: performanceBudgets.delta.serverEvents - 2,
      pendingDeltas: 0,
      providerEventsReceived: performanceBudgets.delta.serverEvents,
      publishedEvents: 2,
    });
    expect(durationMs).toBeLessThan(performanceBudgets.delta.maxServerPublishMs);
    stream.close();
  });

  it("bounds soft and hard WebSocket backpressure without blocking dispatch", () => {
    const softBackpressure = vi.fn();
    const slowClientDisconnect = vi.fn();
    const socket = {
      bufferedAmount: 256 * 1_024 + 1,
      close: vi.fn(),
      readyState: 1,
      send: vi.fn(),
    } satisfies EventStreamSocket;
    const message = {
      latestSequence: 0,
      sessionId: "session-performance",
      type: "connection.ready",
      version: 3,
    } satisfies EventStreamMessage;
    const stringify = vi.spyOn(JSON, "stringify");
    const stringifyCallsBefore = stringify.mock.calls.length;

    const startedAt = performance.now();
    for (let index = 0; index < performanceBudgets.slowWebSocket.messages; index += 1) {
      expect(sendEventStreamMessage(socket, message, softBackpressure, slowClientDisconnect)).toBe(
        true,
      );
    }
    const durationMs = performance.now() - startedAt;

    expect(socket.send).toHaveBeenCalledTimes(performanceBudgets.slowWebSocket.messages);
    expect(stringify.mock.calls.length - stringifyCallsBefore).toBe(1);
    expect(softBackpressure).toHaveBeenCalledTimes(performanceBudgets.slowWebSocket.messages);
    expect(slowClientDisconnect).not.toHaveBeenCalled();
    expect(durationMs).toBeLessThan(performanceBudgets.slowWebSocket.maxDispatchMs);

    socket.bufferedAmount = 1_024 * 1_024 + 1;
    expect(sendEventStreamMessage(socket, message, softBackpressure, slowClientDisconnect)).toBe(
      false,
    );
    expect(socket.send).toHaveBeenCalledTimes(performanceBudgets.slowWebSocket.messages);
    expect(slowClientDisconnect).toHaveBeenCalledOnce();
    expect(socket.close).toHaveBeenCalledWith(1013, "Client is too slow; refresh the snapshot");

    socket.bufferedAmount = 0;
    const events = Array.from({ length: 129 }, (_, index) => ({
      ...createDeltaEvent(String(index)),
      provider: "codex",
      sequence: index + 1,
      sessionId: "session-performance",
      timestamp: fixedTimestamp,
      version: 2 as const,
    }));
    expect(sendEventStreamEvents(socket, events, softBackpressure, slowClientDisconnect)).toBe(
      true,
    );
    const batches = socket.send.mock.calls
      .slice(-3)
      .map(([data]) => JSON.parse(String(data)) as { events: AgentEvent[] });
    expect(batches.map((batch) => batch.events.length)).toEqual([64, 64, 1]);
  });

  it("streams a 50 MiB attachment without retaining its payload on Heap", async () => {
    const root = await mkdtemp(join(tmpdir(), "codexly-attachment-performance-"));
    temporaryRoots.push(root);
    const attachmentDirectory = join(root, "attachments");
    const store = new AttachmentStore({
      attachmentDirectory,
      createId: () => "attachment-performance",
    });
    const chunk = Buffer.alloc(1_024 * 1_024, 0x61);
    const chunkCount = performanceBudgets.attachment.bytes / chunk.byteLength;
    const heapBefore = collectHeap();

    const startedAt = performance.now();
    const { attachment } = await store.add("project-performance", {
      content: Readable.from(
        (function* createChunks() {
          for (let index = 0; index < chunkCount; index += 1) {
            yield chunk;
          }
        })(),
      ),
      kind: "file",
      mediaType: "application/pdf",
      name: "large.pdf",
    });
    const durationMs = performance.now() - startedAt;
    const [resolved] = await store.resolve("project-performance", [attachment.id]);
    if (resolved?.kind !== "file") {
      throw new Error("Expected a materialized file attachment");
    }

    expect(attachment.size).toBe(performanceBudgets.attachment.bytes);
    expect((await stat(resolved.path)).size).toBe(performanceBudgets.attachment.bytes);
    expect(durationMs).toBeLessThan(performanceBudgets.attachment.maxDurationMs);
    expect(collectHeap() - heapBefore).toBeLessThanOrEqual(
      performanceBudgets.attachment.maxHeapGrowthBytes,
    );
    await store.dispose();
  });

  it("reads 500 Git changes with two batched diff commands within budget", async () => {
    const projectRoot = await realpath(await mkdtemp(join(tmpdir(), "codexly-git-performance-")));
    temporaryRoots.push(projectRoot);
    await mkdir(join(projectRoot, ".git"));
    const paths = Array.from(
      { length: performanceBudgets.git.changes },
      (_, index) => `src/file-${String(index).padStart(4, "0")}.ts`,
    );
    const stagedPaths = paths.filter((_, index) => index % 2 === 0);
    const unstagedPaths = paths.filter((_, index) => index % 2 === 1);
    const diffCommands: string[][] = [];
    const executeGit = (_root: string, arguments_: readonly string[]) => {
      if (arguments_[0] === "status") {
        return Promise.resolve(
          paths.map((path, index) => (index % 2 === 0 ? `M  ${path}\0` : ` M ${path}\0`)).join(""),
        );
      }
      if (arguments_[0] === "diff") {
        diffCommands.push([...arguments_]);
        const staged = arguments_.includes("--cached");
        return Promise.resolve(
          createGitDiffOutput(staged ? stagedPaths : unstagedPaths, staged ? "staged" : "unstaged"),
        );
      }
      if (arguments_[0] === "branch") {
        return Promise.resolve("main\n");
      }
      return Promise.resolve("");
    };

    const startedAt = performance.now();
    const status = await readGitWorkingTreeStatus(projectRoot, executeGit, {
      includeDiff: true,
    });
    const durationMs = performance.now() - startedAt;

    expect(status.staged).toHaveLength(stagedPaths.length);
    expect(status.unstaged).toHaveLength(unstagedPaths.length);
    expect(diffCommands).toHaveLength(performanceBudgets.git.maxDiffCommands);
    expect(durationMs).toBeLessThan(performanceBudgets.git.maxDurationMs);
  });

  it("bounds real untracked files, Diff bytes, and child repository Git concurrency", async () => {
    const untrackedRoot = await realpath(
      await mkdtemp(join(tmpdir(), "codexly-git-untracked-performance-")),
    );
    temporaryRoots.push(untrackedRoot);
    await mkdir(join(untrackedRoot, ".git"));
    const untrackedPaths = Array.from(
      { length: performanceBudgets.git.untrackedFiles },
      (_, index) => `file-${String(index).padStart(4, "0")}.txt`,
    );
    const fileContent = "x".repeat(performanceBudgets.git.untrackedFileBytes);
    // 分批创建真实文件，避免测试夹具本身引入无界文件描述符并发。
    for (let offset = 0; offset < untrackedPaths.length; offset += 32) {
      await Promise.all(
        untrackedPaths
          .slice(offset, offset + 32)
          .map((path) => writeFile(join(untrackedRoot, path), fileContent)),
      );
    }
    const executeUntrackedGit = (_root: string, arguments_: readonly string[]) =>
      Promise.resolve(
        arguments_[0] === "status" ? untrackedPaths.map((path) => `?? ${path}\0`).join("") : "",
      );

    const untrackedStartedAt = performance.now();
    const untrackedStatus = await readGitWorkingTreeStatus(untrackedRoot, executeUntrackedGit);
    const untrackedDurationMs = performance.now() - untrackedStartedAt;
    const diffBytes = untrackedStatus.unstaged.reduce(
      (total, change) => total + Buffer.byteLength(change.diff),
      0,
    );

    expect(untrackedStatus.unstaged.length).toBeLessThanOrEqual(performanceBudgets.git.maxFiles);
    expect(diffBytes).toBeLessThanOrEqual(performanceBudgets.git.maxDiffBytes);
    expect(untrackedDurationMs).toBeLessThan(performanceBudgets.git.maxStressDurationMs);

    const childrenRoot = await realpath(
      await mkdtemp(join(tmpdir(), "codexly-git-children-performance-")),
    );
    temporaryRoots.push(childrenRoot);
    for (let index = 0; index < performanceBudgets.git.childRepositories; index += 1) {
      await mkdir(join(childrenRoot, `repository-${String(index).padStart(2, "0")}`, ".git"), {
        recursive: true,
      });
    }
    let activeGitCommands = 0;
    let peakGitCommands = 0;
    const executeChildGit = async (_root: string, arguments_: readonly string[]) => {
      if (arguments_[0] !== "status") {
        return "";
      }
      activeGitCommands += 1;
      peakGitCommands = Math.max(peakGitCommands, activeGitCommands);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeGitCommands -= 1;
      return "";
    };

    await readGitWorkingTreeStatus(childrenRoot, executeChildGit);

    expect(peakGitCommands).toBeLessThanOrEqual(performanceBudgets.git.maxConcurrentGitCommands);
  });

  it("releases repeated Event Stream lifecycles without sustained Heap growth", () => {
    const { deltasPerIteration, iterations, maxGrowthBytes } = performanceBudgets.heap;
    for (let iteration = 0; iteration < 5; iteration += 1) {
      exerciseEventStreamLifecycle(deltasPerIteration);
    }
    const heapBefore = collectHeap();

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      exerciseEventStreamLifecycle(deltasPerIteration);
    }

    expect(collectHeap() - heapBefore).toBeLessThanOrEqual(maxGrowthBytes);
  });
});
