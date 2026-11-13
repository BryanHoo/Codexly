import type { Page } from "@playwright/test";
import type { AcpConfigOption, AcpConfigValues } from "@codexly/protocol";
import { models, customModels } from "./app-shell-data.js";
import { parseRequestRecord } from "./app-shell-request.js";

/** 页面回归使用原始 ACP 选项与完整更新回执，不能继续请求已退出生产的原生设置接口。 */
export async function mockAcpDefaults(page: Page): Promise<void> {
  const values: AcpConfigValues = {
    model: "gpt-5.6-sol",
    reasoning: "high",
    approval: "on-request",
    workspace: "workspace-write",
    webSearch: "cached",
    verbosity: "",
  };
  const select = (
    id: string,
    name: string,
    options: { value: string; name: string }[],
  ): AcpConfigOption => ({
    id,
    name,
    type: "select",
    currentValue: String(values[id] ?? ""),
    options,
  });
  const choices = (entries: string[]) => entries.map((value) => ({ value, name: value }));
  await page.route("**/v1/acp/agents/codex/defaults", async (route) => {
    if (route.request().method() === "PATCH") {
      const input = parseRequestRecord(route.request().postData());
      if (
        typeof input["configId"] !== "string" ||
        (typeof input["value"] !== "string" && typeof input["value"] !== "boolean")
      )
        throw new Error("Invalid ACP config fixture");
      values[input["configId"]] = input["value"];
      if (input["configId"] === "model") values["reasoning"] = "medium";
    }
    await route.fulfill({
      json: {
        configOptions: [
          select(
            "model",
            "模型",
            [...models, ...customModels].map((model) => ({
              value: model.id,
              name: model.displayName,
            })),
          ),
          select(
            "reasoning",
            "思考强度",
            ["最低", "低", "中", "高", "极高"].map((name, index) => ({
              name,
              value: ["minimal", "low", "medium", "high", "xhigh"][index] ?? "",
            })),
          ),
          select("approval", "审批", choices(["on-request", "never"])),
          select("workspace", "工作区", choices(["workspace-write", "danger-full-access"])),
          select("webSearch", "网页搜索", choices(["disabled", "cached", "live"])),
          select("verbosity", "输出详细程度", choices(["", "low", "medium", "high"])),
        ],
        defaults: { ...values },
        unmappedLegacy: [],
        invalidDefaults: [],
      },
    });
  });
}
