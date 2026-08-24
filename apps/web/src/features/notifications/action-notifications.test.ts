import { QueryClient } from "@tanstack/react-query";
import type { MutationCache } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("sonner", () => ({ toast }));

import {
  ACTION_NOTIFICATION_META_KEY,
  createActionMutationCache,
  notifyActionError,
  notifyActionSuccess,
} from "./action-notifications.js";

async function executeMutation(
  mutationCache: MutationCache,
  mutationFn: () => Promise<unknown>,
  meta?: Record<string, unknown>,
): Promise<void> {
  const client = new QueryClient({ mutationCache });
  await client
    .getMutationCache()
    .build(client, { ...(meta === undefined ? {} : { meta }), mutationFn, retry: false })
    .execute(undefined);
}

describe("action notifications", () => {
  beforeEach(() => {
    toast.error.mockReset();
    toast.success.mockReset();
  });

  it("shows one root toast for successful and failed user mutations", async () => {
    const mutationCache = createActionMutationCache();

    await executeMutation(mutationCache, () => Promise.resolve({ status: "ok" }));
    await expect(
      executeMutation(mutationCache, () => Promise.reject(new Error("native RPC details"))),
    ).rejects.toThrow("native RPC details");

    expect(toast.success).toHaveBeenCalledWith("操作成功");
    expect(toast.error).toHaveBeenCalledWith("native RPC details");
  });

  it("supports action-specific success text and explicit silent mutations", async () => {
    const mutationCache = createActionMutationCache();

    await executeMutation(mutationCache, () => Promise.resolve(undefined), {
      [ACTION_NOTIFICATION_META_KEY]: { successMessage: "设置已保存" },
    });
    await executeMutation(mutationCache, () => Promise.resolve(undefined), {
      [ACTION_NOTIFICATION_META_KEY]: false,
    });

    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("设置已保存");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("normalizes direct action results through the same root channel", () => {
    notifyActionSuccess("项目已添加");
    notifyActionError(new Error("fatal: not a git repository"));

    expect(toast.success).toHaveBeenCalledWith("项目已添加");
    expect(toast.error).toHaveBeenCalledWith("fatal: not a git repository");
  });
});
