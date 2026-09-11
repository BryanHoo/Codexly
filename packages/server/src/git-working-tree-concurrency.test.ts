import { mkdir, mkdtemp, rm } from "node:fs/promises";
import type * as FileSystem from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

const fileIO = vi.hoisted(() => ({ active: 0, peak: 0 }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof FileSystem>();
  return {
    ...original,
    lstat: async (...args: Parameters<typeof original.lstat>) => {
      fileIO.active += 1;
      fileIO.peak = Math.max(fileIO.peak, fileIO.active);
      try {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return await original.lstat(...args);
      } finally {
        fileIO.active -= 1;
      }
    },
  };
});

import { readGitWorkingTreeStatus } from "./git-working-tree.js";

const roots: string[] = [];
async function createRoot() {
  const root = await mkdtemp(join(tmpdir(), "codexly-git-concurrency-"));
  roots.push(root);
  await mkdir(join(root, ".git"));
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  fileIO.peak = 0;
});

describe("Git status request concurrency", () => {
  it("shares process and file IO limits across distinct repositories", async () => {
    const repositories = await Promise.all(Array.from({ length: 12 }, createRoot));
    let active = 0;
    let peak = 0;
    const executeGit = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await delay(5);
      active -= 1;
      return "";
    };
    await Promise.all(repositories.map((root) => readGitWorkingTreeStatus(root, executeGit)));
    expect(peak).toBeLessThanOrEqual(4);
    expect(fileIO.peak).toBeLessThanOrEqual(8);
  });

  it("coalesces identical reads but separates queries and removes settled entries", async () => {
    const root = await createRoot();
    const executeGit = vi.fn(async (_root: string, _args: readonly string[]) => {
      await delay(10);
      return "";
    });
    const requests = Array.from({ length: 8 }, (_, index) =>
      readGitWorkingTreeStatus(index % 2 === 0 ? root : `${root}/.`, executeGit),
    );
    await Promise.all(requests);
    const countStatuses = () =>
      executeGit.mock.calls.filter((args) => args[1][0] === "status").length;
    expect(countStatuses()).toBe(1);
    await Promise.all([
      readGitWorkingTreeStatus(root, executeGit),
      readGitWorkingTreeStatus(root, executeGit, { includeDiff: true }),
    ]);
    expect(countStatuses()).toBe(3);
  });

  it("evicts failures so subsequent reads can retry", async () => {
    const root = await createRoot();
    let fail = true;
    let statusReads = 0;
    const executeGit = async (_root: string, args: readonly string[]) => {
      await delay(5);
      if (args[0] === "status") {
        statusReads += 1;
        if (fail) throw new Error("status unavailable");
      }
      return "";
    };
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => readGitWorkingTreeStatus(root, executeGit)),
    );
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(statusReads).toBe(1);
    fail = false;
    await readGitWorkingTreeStatus(root, executeGit);
    expect(statusReads).toBe(2);
  });
});
