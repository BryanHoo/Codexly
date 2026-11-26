import { expect, it, vi } from "vitest";
import {
  applicationPreferencesFromLegacy,
  ApplicationPreferencesService,
} from "./application-preferences.js";
import type { LocalCatalogStore } from "./local-catalog.js";

it("旧偏好只投影应用字段，补齐缺省值而不猜模型或引擎原生配置", () => {
  const empty = applicationPreferencesFromLegacy(undefined);
  expect(empty.defaultModel).toBeNull();
  const source = {
    defaultAgent: "claude",
    defaultModel: "raw/model",
    commitMessagePrompt: "规则",
    pet: { enabled: true, selectedPetId: "pet" },
    model: "不属于应用",
    approvalPolicy: "never",
    unknown: 42,
  };
  const bytes = JSON.stringify(source);
  expect(applicationPreferencesFromLegacy(source)).toEqual({
    ...empty,
    defaultAgent: "claude",
    defaultModel: "raw/model",
    commitMessagePrompt: "规则",
    pet: { enabled: true, selectedPetId: "pet" },
  });
  expect(JSON.stringify(source)).toBe(bytes);
});
it("私有记录存在后不依赖旧来源可读，无记录读取不落盘，来源失败可重试", async () => {
  const preferences = applicationPreferencesFromLegacy(undefined);
  const legacy = vi
    .fn()
    .mockRejectedValueOnce(new Error("旧文件损坏"))
    .mockResolvedValue(undefined);
  const catalog = vi.fn().mockResolvedValue(null);
  const service = new ApplicationPreferencesService({ catalog } as LocalCatalogStore, legacy);
  await expect(service.read()).rejects.toThrow("旧文件损坏");
  expect(await service.read()).toEqual(preferences);
  expect(catalog.mock.calls.every(([op]) => op === "app.preferences.read")).toBe(true);
  catalog.mockResolvedValue(preferences);
  legacy.mockClear();
  expect(await service.read()).toEqual(preferences);
  expect(legacy).not.toHaveBeenCalled();
});
