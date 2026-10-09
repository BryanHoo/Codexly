import { QueryClient } from "@tanstack/react-query";
import type { MutationCache } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("sonner", () => ({ toast }));

import {
  ACTION_NOTIFICATION_META_KEY,
  actionErrorMessage,
  createActionMutationCache,
  notifyActionError,
  notifyActionSuccess,
} from "./action-notifications.js";
import { i18n } from "../../i18n/i18n.js";

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
  afterEach(async () => {
    await i18n.changeLanguage("zh-CN");
  });

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

  it("explains why fork history blocks deletion without changing the original error", async () => {
    const message =
      "cannot delete thread 01a03139-f883-73c1-abad-402de0de6252: forked history still references it";
    const error = new Error(message);

    await expect(
      executeMutation(createActionMutationCache(), () => Promise.reject(error)),
    ).rejects.toBe(error);

    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      "无法删除此任务：分叉任务仍在使用它的历史记录。你可以归档此任务，或先删除相关分叉任务后再试。",
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(error.message).toBe(message);
  });

  it("uses the selected language for fork history deletion guidance", async () => {
    await i18n.changeLanguage("en");
    expect(
      actionErrorMessage("cannot delete thread task-1: forked history still references it"),
    ).toBe(
      "This task can’t be deleted because forked tasks still use its history. You can archive it, or delete the related forked tasks first and try again.",
    );
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
