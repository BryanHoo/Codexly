import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { AgentTaskScope } from "@code-agent/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CodexGitMetadataWatchService } from "./git-metadata-watch.js";

const temporaryRoots: string[] = [];

async function createTemporaryRoot(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `code-agent-${name}-`));
  temporaryRoots.push(root);
  return root;
}

async function write(path: string, content = ""): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

function projectScope(
  rootPath: string,
  roots: readonly string[] = [rootPath],
  id = "project-1",
): AgentTaskScope {
  return {
    id,
    kind: "project",
    rootPath,
    runtimeWorkspaceRoots: roots,
  };
}

function createClient(
  requestImplementation: (method: string, params: unknown) => Promise<unknown> = (
    method,
    params,
  ) => {
    const path = (params as { path?: string }).path;
    return Promise.resolve(method === "fs/watch" ? { path } : {});
  },
) {
  return { request: vi.fn(requestImplementation) };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("CodexGitMetadataWatchService", () => {
  it("watches only key metadata paths for normal repositories and linked worktrees", async () => {
    const normalRoot = await createTemporaryRoot("normal-git-watch");
    await write(join(normalRoot, ".git", "HEAD"), "ref: refs/heads/main\n");
    await write(join(normalRoot, ".git", "index"));
    await write(join(normalRoot, ".git", "refs", "heads", "main"), "a".repeat(40));

    const linkedRoot = await createTemporaryRoot("linked-git-watch");
    const commonDir = await createTemporaryRoot("common-git-watch");
    const gitDir = join(commonDir, "worktrees", "linked");
    await write(join(linkedRoot, ".git"), `gitdir: ${gitDir}\n`);
    await write(join(gitDir, "commondir"), "../..\n");
    await write(join(gitDir, "HEAD"), "ref: refs/heads/feature/nested\n");
    await write(join(gitDir, "index"));
    await write(join(commonDir, "refs", "heads", "feature", "nested"), "b".repeat(40));

    const client = createClient();
    const service = new CodexGitMetadataWatchService(client, {
      logger: { warn: vi.fn() },
      onChanged: vi.fn(),
    });
    await service.watchProject(projectScope(normalRoot, [normalRoot, linkedRoot]));

    const watchedPaths = client.request.mock.calls
      .filter(([method]) => method === "fs/watch")
      .map(([, params]) => (params as { path: string }).path);
    expect(watchedPaths).toEqual(
      expect.arrayContaining([
        join(normalRoot, ".git", "HEAD"),
        join(normalRoot, ".git", "index"),
        join(normalRoot, ".git", "packed-refs"),
        join(normalRoot, ".git", "refs", "heads", "main"),
        join(gitDir, "HEAD"),
        join(gitDir, "index"),
        join(commonDir, "packed-refs"),
        join(commonDir, "refs", "heads", "feature", "nested"),
      ]),
    );
    expect(new Set(watchedPaths).size).toBe(watchedPaths.length);
    expect(watchedPaths).toHaveLength(8);
    expect(watchedPaths).not.toContain(join(linkedRoot, ".git"));
    expect(watchedPaths).not.toContain(join(gitDir, "commondir"));
    expect(watchedPaths).not.toContain(join(normalRoot, ".git", "refs", "heads"));

    await service.releaseProject("project-1");
  });

  it("enforces one global native Watch budget across Projects", async () => {
    const firstRoot = await createTemporaryRoot("git-watch-budget-first");
    const secondRoot = await createTemporaryRoot("git-watch-budget-second");
    await write(join(firstRoot, ".git", "HEAD"), "ref: refs/heads/main\n");
    await write(join(secondRoot, ".git", "HEAD"), "ref: refs/heads/main\n");
    const client = createClient();
    const service = new CodexGitMetadataWatchService(client, {
      logger: { warn: vi.fn() },
      maxWatchCount: 3,
      onChanged: vi.fn(),
    });

    await service.watchProject(projectScope(firstRoot, [firstRoot], "project-1"));
    await service.watchProject(projectScope(secondRoot, [secondRoot], "project-2"));

    expect(client.request.mock.calls.filter(([method]) => method === "fs/watch")).toHaveLength(3);
    await service.releaseProject("project-1");
    await service.releaseProject("project-2");
  });

  it("silently skips non-Git Projects", async () => {
    const root = await createTemporaryRoot("non-git-watch");
    const client = createClient();
    const logger = { warn: vi.fn() };
    const service = new CodexGitMetadataWatchService(client, {
      logger,
      onChanged: vi.fn(),
    });

    await service.watchProject(projectScope(root));

    expect(client.request).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    await service.releaseProject("project-1");
  });

  it("debounces fs/changed by configured root and refreshes HEAD topology", async () => {
    vi.useFakeTimers();
    const root = await createTemporaryRoot("git-watch-event");
    const headPath = join(root, ".git", "HEAD");
    await write(headPath, "ref: refs/heads/main\n");
    await write(join(root, ".git", "refs", "heads", "main"), "a".repeat(40));

    const onChanged = vi.fn();
    const client = createClient();
    const service = new CodexGitMetadataWatchService(client, {
      debounceMs: 10,
      logger: { warn: vi.fn() },
      onChanged,
    });
    await service.watchProject(projectScope(root));
    const headWatch = client.request.mock.calls.find(
      ([method, params]) => method === "fs/watch" && (params as { path: string }).path === headPath,
    );
    const watchId = (headWatch?.[1] as { watchId?: string } | undefined)?.watchId;
    expect(watchId).toBeTypeOf("string");

    service.receiveNotification("fs/changed", { changedPaths: [headPath], watchId });
    service.receiveNotification("fs/changed", { changedPaths: [headPath], watchId });
    await write(headPath, "ref: refs/heads/feature\n");
    await write(join(root, ".git", "refs", "heads", "feature"), "b".repeat(40));
    await vi.advanceTimersByTimeAsync(10);
    await service.watchProject(projectScope(root));

    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledWith("project-1", root);
    expect(
      client.request.mock.calls.some(
        ([method, params]) =>
          method === "fs/watch" &&
          (params as { path?: string }).path === join(root, ".git", "refs", "heads", "feature"),
      ),
    ).toBe(true);

    await service.releaseProject("project-1");
  });

  it("unwatches a registration that finishes while Project release is in progress", async () => {
    const root = await createTemporaryRoot("git-watch-release");
    await write(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    let resolveWatch: ((value: unknown) => void) | undefined;
    const watchResponse = new Promise<unknown>((resolve) => {
      resolveWatch = resolve;
    });
    const client = createClient((method, params) =>
      method === "fs/watch" ? watchResponse : Promise.resolve({ params }),
    );
    const service = new CodexGitMetadataWatchService(client, {
      logger: { warn: vi.fn() },
      onChanged: vi.fn(),
    });

    const watching = service.watchProject(projectScope(root));
    await vi.waitFor(() => {
      expect(client.request).toHaveBeenCalledTimes(1);
    });
    const watchId = (client.request.mock.calls[0]?.[1] as { watchId: string }).watchId;
    const releasing = service.releaseProject("project-1");
    resolveWatch?.({ path: join(root, ".git", "HEAD") });
    await Promise.all([watching, releasing]);

    expect(client.request).toHaveBeenCalledWith("fs/unwatch", { watchId });
  });
});
