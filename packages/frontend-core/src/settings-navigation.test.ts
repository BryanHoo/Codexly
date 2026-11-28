import { it, expect } from "vitest";
import {
  settingsSectionGroups,
  settingsSectionSearchKeys,
  settingsSectionEngine,
  resolveSettingsSection,
} from "./settings-navigation.js";

it("从两端应用设置导航和搜索中移除网络代理", () => {
  expect(settingsSectionGroups.find((group) => group.id === "app")?.sections).not.toContain(
    "network",
  );
  expect(settingsSectionSearchKeys).not.toHaveProperty("network");
});

it("将 ACP 与全局指令并列归入智能体并保留旧入口的引擎归属", () => {
  expect(settingsSectionGroups.find(({ id }) => id === "agents")?.sections).toEqual([
    "acp",
    "global-instructions",
  ]);
  const sections = settingsSectionGroups.flatMap((group) => [...group.sections]);
  expect(sections).toContain("acp");
  expect(sections).not.toContain("provider");
  expect(sections).not.toContain("claude-agent");
  expect(resolveSettingsSection("claude-provider")).toBe("acp");
  expect(resolveSettingsSection("agent")).toBe("acp");
  expect(resolveSettingsSection("appearance")).toBe("appearance");
  expect(settingsSectionEngine("acp")).toBeUndefined();
});
