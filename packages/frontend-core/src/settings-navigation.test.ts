import { it, expect } from "vitest";
import {
  settingsSectionGroups,
  settingsSectionSearchKeys,
  settingsSectionEngine,
} from "./settings-navigation.js";

it("将网络归入应用设置并提供搜索入口，不绑定智能体", () => {
  expect(settingsSectionGroups.find((group) => group.id === "app")?.sections).toContain("network");
  expect(settingsSectionSearchKeys).toHaveProperty("network");
  expect(settingsSectionEngine("network")).toBeUndefined();
});
