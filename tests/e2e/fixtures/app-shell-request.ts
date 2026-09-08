import { expect, type Page } from "@playwright/test";

// 集中解析 E2E mock 接收到的结构化请求。
export function isRequestRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseRequestRecord(requestBody: string | null): Record<string, unknown> {
  const value: unknown = JSON.parse(requestBody ?? "null");
  if (!isRequestRecord(value)) {
    throw new Error("Invalid JSON request body");
  }
  return value;
}

export async function chooseHostAttachment(
  page: Page,
  kind: "file" | "image",
  fileName: string,
): Promise<void> {
  await page.getByRole("button", { name: "添加图片或文件" }).click();
  await page
    .getByRole("group", { name: "部署主机" })
    .getByRole("menuitem", { name: kind === "image" ? "添加图片" : "添加文件" })
    .click();
  const dialog = page.getByRole("dialog", {
    name: kind === "image" ? "选择部署主机图片" : "选择部署主机文件",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("treeitem", { exact: true, name: fileName }).click();
  await dialog.getByRole("button", { name: "添加所选文件" }).click();
}

export async function chooseBrowserAttachment(
  page: Page,
  kind: "file" | "image",
  file: Readonly<{ buffer: Buffer; mimeType: string; name: string }>,
): Promise<void> {
  await page.getByRole("button", { name: "添加图片或文件" }).click();
  await page
    .getByRole("group", { name: "当前设备" })
    .getByRole("menuitem", { name: kind === "image" ? "添加图片" : "添加文件" })
    .click();
  await page.locator(`input[data-prompt-input-picker="${kind}"]`).setInputFiles({
    buffer: file.buffer,
    mimeType: file.mimeType,
    name: file.name,
  });
}

export async function enableLanAccess(page: Page): Promise<void> {
  // 主机文件入口只在 LAN 模式出现，相关用例必须显式声明访问模式。
  await page.route("**/v1/access", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { authenticated: true, mode: "lan", version: 1 },
    });
  });
}

export function parseProjectDefaultsRequest(requestBody: string | null) {
  const settings = parseTaskSettingsRequest(requestBody);
  const value = parseRequestRecord(requestBody);
  const fastMode = value["fastMode"];
  if (typeof fastMode !== "boolean") {
    throw new Error("Invalid project defaults request");
  }
  return { ...settings, fastMode };
}

export function parseTaskSettingsRequest(requestBody: string | null) {
  const value = parseRequestRecord(requestBody);
  const approvalPolicy = value["approvalPolicy"];
  const approvalsReviewer = value["approvalsReviewer"];
  const model = value["model"];
  const reasoningEffort = value["reasoningEffort"];
  const sandboxMode = value["sandboxMode"];
  if (
    typeof approvalPolicy !== "string" ||
    typeof approvalsReviewer !== "string" ||
    typeof model !== "string" ||
    typeof reasoningEffort !== "string" ||
    typeof sandboxMode !== "string"
  ) {
    throw new Error("Invalid task settings request");
  }
  return { approvalPolicy, approvalsReviewer, model, reasoningEffort, sandboxMode };
}

export function parseGlobalSettingsRequest(requestBody: string | null) {
  const settings = parseTaskSettingsRequest(requestBody);
  const value = parseRequestRecord(requestBody);
  const commitMessageModel = value["commitMessageModel"];
  const commitMessagePrompt = value["commitMessagePrompt"];
  const defaultOpenAppId = value["defaultOpenAppId"];
  const fastMode = value["fastMode"];
  const followUpBehavior = value["followUpBehavior"];
  const pet = value["pet"];
  if (
    typeof commitMessageModel !== "string" ||
    typeof commitMessagePrompt !== "string" ||
    typeof fastMode !== "boolean" ||
    (followUpBehavior !== "queue" && followUpBehavior !== "steer") ||
    (defaultOpenAppId !== null && typeof defaultOpenAppId !== "string") ||
    !isRequestRecord(pet) ||
    typeof pet["enabled"] !== "boolean" ||
    (pet["selectedPetId"] !== null && typeof pet["selectedPetId"] !== "string") ||
    (pet["enabled"] && typeof pet["selectedPetId"] !== "string")
  ) {
    throw new Error("Invalid global settings request");
  }
  const normalizedFollowUpBehavior: "queue" | "steer" =
    followUpBehavior === "queue" ? "queue" : "steer";
  return {
    ...settings,
    commitMessageModel,
    commitMessagePrompt,
    defaultOpenAppId,
    fastMode,
    followUpBehavior: normalizedFollowUpBehavior,
    pet: { enabled: pet["enabled"], selectedPetId: pet["selectedPetId"] },
  };
}

export function parseProjectOrderRequest(requestBody: string | null): readonly string[] {
  const value = parseRequestRecord(requestBody);
  const projectIds = value["projectIds"];
  if (
    !Array.isArray(projectIds) ||
    !projectIds.every((projectId) => typeof projectId === "string")
  ) {
    throw new Error("Invalid project order request");
  }
  return projectIds;
}
