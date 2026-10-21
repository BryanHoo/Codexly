import { QueryClient } from "@tanstack/react-query";
import type { CodexlyClient } from "@codexly/client";
import { beforeEach, expect, it, vi } from "vitest";
import {
  createSavedPromptStore,
  SAVED_PROMPTS_STORAGE_KEY,
} from "@codexly/frontend-core/saved-prompts";
import { projectRemoveMutationOptions } from "./project-query-options.js";

const state = vi.hoisted(() => ({ values: new Map<string, string>(), writable: true }));
vi.mock("@codexly/ui/core/saved-prompts-store", async () => {
  const { createSavedPromptStore } = await import("@codexly/frontend-core/saved-prompts");
  return {
    savedPromptsStore: createSavedPromptStore({
      getItem: (key) => state.values.get(key) ?? null,
      setItem: (key, value) => {
        if (!state.writable) throw new Error("denied");
        state.values.set(key, value);
      },
    }),
  };
});
const storage = {
  getItem: (key: string) => state.values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    state.values.set(key, value);
  },
};
beforeEach(() => {
  state.values.clear();
  state.writable = true;
});

it("仅在项目删除成功后清理该项目提示词，保留全局和其他项目", async () => {
  const store = createSavedPromptStore(storage);
  const global = store.save({ name: "全局", shortcut: "check", content: "内容" });
  store.save({ name: "项目", shortcut: "check", content: "内容", projectId: "a" });
  const b = store.save({ name: "其他", shortcut: "check", content: "内容", projectId: "b" });
  const response = {
    projectId: "a",
    status: "removed" as const,
    projects: { data: [], nextCursor: null },
  };
  const removeProject = vi.fn<CodexlyClient["removeProject"]>().mockResolvedValue(response);
  const mutate = projectRemoveMutationOptions({ removeProject }).mutationFn;
  if (!mutate) throw new Error("Missing project removal mutation");
  await mutate("a", { client: new QueryClient(), meta: undefined });
  expect(removeProject).toHaveBeenCalledWith("a");
  expect(createSavedPromptStore(storage).getSnapshot()).toEqual([global, b]);
});

it("远端失败时保留提示词，本机存储不可写时阻止远端删除", async () => {
  const store = createSavedPromptStore(storage);
  store.save({ name: "项目", shortcut: "check", content: "内容", projectId: "a" });
  const original = state.values.get(SAVED_PROMPTS_STORAGE_KEY);
  const removeProject = vi
    .fn<CodexlyClient["removeProject"]>()
    .mockRejectedValue(new Error("offline"));
  const mutate = projectRemoveMutationOptions({ removeProject }).mutationFn;
  if (!mutate) throw new Error("Missing project removal mutation");
  await expect(mutate("a", { client: new QueryClient(), meta: undefined })).rejects.toThrow(
    "offline",
  );
  expect(state.values.get(SAVED_PROMPTS_STORAGE_KEY)).toBe(original);
  removeProject.mockClear();
  state.writable = false;
  await expect(mutate("a", { client: new QueryClient(), meta: undefined })).rejects.toThrow(
    "denied",
  );
  expect(removeProject).not.toHaveBeenCalled();
  expect(state.values.get(SAVED_PROMPTS_STORAGE_KEY)).toBe(original);
});
