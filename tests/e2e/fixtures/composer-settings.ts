import type { Locator } from "@playwright/test";

const settingLabels: Readonly<Record<string, string>> = {
  "on-request": "按需审批",
  "auto-review": "自动审核",
  never: "从不询问",
  "read-only": "只读",
  "workspace-write": "工作区可写",
  "danger-full-access": "完全访问",
};

export async function selectComposerSetting(trigger: Locator, value: string) {
  const name = settingLabels[value];
  if (name === undefined) throw new Error(`Unknown composer setting: ${value}`);
  await trigger.click();
  await trigger.page().getByRole("menuitemradio", { name, exact: true }).click();
}
