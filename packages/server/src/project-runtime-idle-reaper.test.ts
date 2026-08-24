import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectRuntimeContext } from "./routes/context.js";
import { ProjectRuntimeIdleReaper } from "./project-runtime-idle-reaper.js";

function createContext(activeClients = 0): ProjectRuntimeContext {
  return {
    eventStream: {} as ProjectRuntimeContext["eventStream"],
    scope: {
      id: "project",
      kind: "project",
      rootPath: "/workspace",
      runtimeWorkspaceRoots: ["/workspace"],
    },
    provider: {} as ProjectRuntimeContext["provider"],
    transportMetrics: { activeClients, slowClientDisconnects: 0 },
    unsubscribe: () => undefined,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ProjectRuntimeIdleReaper", () => {
  it("releases only contexts whose last activity exceeded the idle TTL", async () => {
    vi.useFakeTimers();
    let now = 0;
    const contexts = new Map<string, ProjectRuntimeContext>([
      ["project-active", createContext()],
      ["project-idle", createContext()],
    ]);
    const release = vi.fn((projectId: string) => {
      contexts.delete(projectId);
      return Promise.resolve();
    });
    const reaper = new ProjectRuntimeIdleReaper({
      cleanupIntervalMs: 10,
      clock: () => now,
      contexts,
      idleTtlMs: 50,
      release,
    });
    reaper.touch("project-active");
    reaper.touch("project-idle");

    now = 40;
    reaper.touch("project-active");
    now = 50;
    await vi.advanceTimersByTimeAsync(10);

    expect(release).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledWith("project-idle");
    expect(contexts.has("project-active")).toBe(true);
    await reaper.close();
  });

  it("keeps active clients and newly touched provider activity alive", async () => {
    vi.useFakeTimers();
    let now = 0;
    const context = createContext(1);
    const contexts = new Map<string, ProjectRuntimeContext>([["project-1", context]]);
    const release = vi.fn(() => Promise.resolve());
    const reaper = new ProjectRuntimeIdleReaper({
      cleanupIntervalMs: 10,
      clock: () => now,
      contexts,
      idleTtlMs: 50,
      release,
    });
    reaper.touch("project-1");

    now = 60;
    await vi.advanceTimersByTimeAsync(10);
    expect(release).not.toHaveBeenCalled();

    context.transportMetrics.activeClients = 0;
    reaper.touch("project-1");
    now = 109;
    await vi.advanceTimersByTimeAsync(10);
    expect(release).not.toHaveBeenCalled();
    now = 110;
    await vi.advanceTimersByTimeAsync(10);
    expect(release).toHaveBeenCalledOnce();
    await reaper.close();
  });

  it("does not overlap releases and clears its timer on close", async () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    let now = 0;
    let finishRelease: (() => void) | undefined;
    const contexts = new Map<string, ProjectRuntimeContext>([["project-1", createContext()]]);
    const release = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRelease = resolve;
        }),
    );
    const reaper = new ProjectRuntimeIdleReaper({
      cleanupIntervalMs: 10,
      clock: () => now,
      contexts,
      idleTtlMs: 50,
      release,
    });
    reaper.touch("project-1");

    now = 100;
    await vi.advanceTimersByTimeAsync(30);

    expect(release).toHaveBeenCalledOnce();
    finishRelease?.();
    await Promise.resolve();
    await reaper.close();
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });
});
