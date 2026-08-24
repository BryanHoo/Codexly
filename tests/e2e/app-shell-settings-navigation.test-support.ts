import type { Page } from "@playwright/test";

// 集中维护该组 Playwright 流程使用的页面操作。
export function getComposerModelSelector(page: Page) {
  return page.getByRole("button", { name: /^模型和思考量：/u });
}

export async function selectComposerModel(page: Page, modelName: string): Promise<void> {
  await getComposerModelSelector(page).click();
  await page.getByRole("menuitem", { name: "选择模型" }).click();
  await page
    .getByRole("menu", { name: "选择模型" })
    .getByRole("menuitemradio", { name: new RegExp(modelName, "u") })
    .click();
}

export async function selectComposerReasoning(page: Page, effortName: string): Promise<void> {
  await getComposerModelSelector(page).click();
  await page.getByRole("menuitem", { name: "选择思考量" }).click();
  await page
    .getByRole("menu", { name: "选择思考量" })
    .getByRole("menuitemradio", { name: new RegExp(`^${effortName}`, "u") })
    .click();
}
