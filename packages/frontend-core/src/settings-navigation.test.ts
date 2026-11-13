import { it, expect } from "vitest";
import {
  settingsSectionGroups,
  settingsSectionSearchKeys,
  settingsSectionEngine,
  resolveSettingsSection,
} from "./settings-navigation.js";

it("将网络归入应用设置并提供搜索入口，不绑定智能体", () => {
  expect(settingsSectionGroups.find((group) => group.id === "app")?.sections).toContain("network");
  expect(settingsSectionSearchKeys).toHaveProperty("network");
  expect(settingsSectionEngine("network")).toBeUndefined();
});

it("将智能体设置收束为 ACP 入口并保留旧入口的引擎归属", () => {
  const sections = settingsSectionGroups.flatMap((group) => [...group.sections]);
  expect(sections).toContain("acp");
  expect(sections).not.toContain("provider");
  expect(sections).not.toContain("claude-agent");
  expect(resolveSettingsSection("claude-provider")).toBe("acp");
  expect(resolveSettingsSection("agent")).toBe("acp");
  expect(resolveSettingsSection("appearance")).toBe("appearance");
  expect(settingsSectionEngine("acp")).toBeUndefined();
});
