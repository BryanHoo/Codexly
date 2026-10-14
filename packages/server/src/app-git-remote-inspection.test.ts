import type { PushProjectCommitsRequest, PushProjectCommitsResponse } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";
import { createCodexlyServer } from "./app.js";
import {
  closeCallbacks,
  createProvider,
  createServerOptions,
  encodedProjectRootPath,
} from "./app-all.test-support.js";

const checked = { branch: "main", pushStatus: "checked", pushError: null } as const;
const url = `/v1/projects/codexly/git/push?rootPath=${encodedProjectRootPath}`;
const snapshot = "a".repeat(64);

// 用可控的执行边界稳定制造重叠请求，验证真实 HTTP 路由的锁而不是客户端模拟。
async function createPendingOperation() {
  let finish!: (result: PushProjectCommitsResponse) => void;
  const pending = new Promise<PushProjectCommitsResponse>((resolve) => {
    finish = resolve;
  });
  const operation = vi.fn((_rootPath: string, _request: PushProjectCommitsRequest) =>
    Promise.resolve(checked as PushProjectCommitsResponse),
  );
  operation.mockReturnValueOnce(pending);
  const { provider } = createProvider();
  const app = await createCodexlyServer(
    createServerOptions(provider, { pushProjectCommits: operation }),
  );
  closeCallbacks.push(() => app.close());
  const request = (
    key: string,
    action: PushProjectCommitsRequest["action"],
    expectedSnapshot = snapshot,
  ) =>
    app.inject({
      method: "POST",
      url,
      payload: { action, expectedSnapshot },
      headers: { "idempotency-key": key },
    });
  return {
    operation,
    request,
    finish: () => {
      finish(checked);
    },
  };
}

describe("server Git remote inspection concurrency", () => {
  it("allows overlapping inspections for snapshots before and after a commit", async () => {
    const { operation, request, finish } = await createPendingOperation();
    const first = request("inspect-before", "inspect");
    try {
      await vi.waitFor(() => {
        expect(operation).toHaveBeenCalledOnce();
      });
      const next = await request("inspect-after", "inspect", "b".repeat(64));
      expect(next.statusCode).toBe(200);
      expect(next.json()).toEqual(checked);
      expect(operation).toHaveBeenCalledTimes(2);
    } finally {
      finish();
      await first;
    }
  });

  it("does not block a write while an inspection is still running", async () => {
    const { operation, request, finish } = await createPendingOperation();
    const first = request("inspect-pending", "inspect");
    try {
      await vi.waitFor(() => {
        expect(operation).toHaveBeenCalledOnce();
      });
      expect((await request("fetch-during-inspect", "fetch")).statusCode).toBe(200);
      expect(operation).toHaveBeenCalledTimes(2);
    } finally {
      finish();
      await first;
    }
  });

  it("allows inspection during a write without releasing the writer's lock", async () => {
    const { operation, request, finish } = await createPendingOperation();
    const first = request("fetch-pending", "fetch");
    try {
      await vi.waitFor(() => {
        expect(operation).toHaveBeenCalledOnce();
      });
      expect((await request("inspect-during-fetch", "inspect")).statusCode).toBe(200);
      const concurrent = await request("push-during-fetch", "push");
      expect(concurrent.statusCode).toBe(409);
      expect(concurrent.json()).toMatchObject({ code: "GIT_MUTATION_IN_PROGRESS" });
      expect(operation).toHaveBeenCalledTimes(2);
    } finally {
      finish();
      await first;
    }
    expect((await request("push-after-fetch", "push")).statusCode).toBe(200);
  });
});
