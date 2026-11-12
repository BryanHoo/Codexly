import { expect, it, vi } from "vitest";
import * as queries from "./engine-settings-query.js";
import * as autosave from "./settings-autosave.js";
import type { ApplicationPreferences } from "@codexly/protocol/application-preferences";
const baseline: ApplicationPreferences = {
  defaultAgent: "codex",
  defaultModel: null,
  commitMessagePrompt: "",
  taskTitlePrompt: "",
  promptOptimizationPrompt: "",
  defaultOpenAppId: null,
  followUpBehavior: "queue",
  pet: { enabled: false, selectedPetId: null },
};
const fixture = () => ({
  getGlobalSettings: vi.fn(),
  updateGlobalSettings: vi.fn(),
  getApplicationPreferences: vi.fn(() => Promise.resolve(baseline)),
  patchApplicationPreferences: vi.fn(() => Promise.resolve(baseline)),
});
it("等待能力及 ACP 查询不读取旧设置，缓存隔离且保留取消", async () => {
  const client = fixture(),
    signal = new AbortController().signal;
  const pending = queries.applicationSettingsQuery(client, "codex", "pending");
  expect(pending.enabled).toBe(false);
  await expect(pending.queryFn({ signal })).rejects.toThrow("runtime");
  const acp = queries.applicationSettingsQuery(client, "claude", "acp");
  expect(await acp.queryFn({ signal })).toEqual({ settings: baseline });
  expect(client.getApplicationPreferences).toHaveBeenCalledWith({ signal });
  expect(client.getGlobalSettings).not.toHaveBeenCalled();
  expect(acp.queryKey).not.toEqual(queries.engineSettingsQuery(client, "claude").queryKey);
});
it("ACP 补丁仅包含本地改动，模型配对，空草稿不写入，legacy 保留旧调用", async () => {
  const client = fixture();
  const mutation = queries.applicationSettingsMutation(client, "codex", "acp");
  await mutation.mutationFn({
    settings: { ...baseline, taskTitlePrompt: "新标题" },
    baseline,
    idempotencyKey: "stable",
  });
  expect(client.patchApplicationPreferences).toHaveBeenLastCalledWith(
    { taskTitlePrompt: "新标题" },
    { idempotencyKey: "stable" },
  );
  await mutation.mutationFn({ settings: { ...baseline, defaultModel: "raw/model" }, baseline });
  expect(client.patchApplicationPreferences).toHaveBeenLastCalledWith(
    { defaultAgent: "codex", defaultModel: "raw/model" },
    {},
  );
  const count = client.patchApplicationPreferences.mock.calls.length;
  await mutation.mutationFn({ settings: baseline, baseline });
  expect(client.patchApplicationPreferences).toHaveBeenCalledTimes(count);
  expect(client.updateGlobalSettings).not.toHaveBeenCalled();
});
it("草稿串行成功后才推进本地基线，失败重试保留身份，不接管服务器其他字段", async () => {
  let key = 0;
  const persist = vi.fn().mockRejectedValueOnce(new Error("断线")).mockResolvedValue(undefined);
  const state = autosave.createSettingsDraftPersistence(persist, () => `k${String(++key)}`);
  state.reset(baseline);
  const a = { ...baseline, taskTitlePrompt: "a" };
  await expect(state.save(a)).rejects.toThrow("断线");
  await state.save(a);
  expect(persist.mock.calls[0]).toEqual(persist.mock.calls[1]);
  const b = { ...a, commitMessagePrompt: "b" };
  await state.save(b);
  expect(persist).toHaveBeenLastCalledWith(b, a, "k2");
});
