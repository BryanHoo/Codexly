import type { AgentModel, AgentTaskSettings } from "@/protocol/index.js";
import { useState } from "react";
import { expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import { ComposerModelSelector } from "./composer-model-selector.js";
import "../../../shared/styles/globals.css";

const models: readonly AgentModel[] = [
  {
    id: "model-a",
    displayName: "Model A",
    description: "",
    isDefault: true,
    inputModalities: ["text"],
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: ["low", "high"].map((id) => ({ id, description: "" })),
  },
  {
    id: "model-b",
    displayName: "Model B",
    description: "",
    isDefault: false,
    inputModalities: ["text"],
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium"].map((id) => ({ id, description: "" })),
  },
];

function SelectorHarness() {
  const [settings, setSettings] = useState<AgentTaskSettings>({
    model: "model-a",
    reasoningEffort: "high",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandboxMode: "workspace-write",
  });

  return (
    <I18nextProvider i18n={i18n}>
      <ComposerModelSelector
        activeSettings={settings}
        disabled={false}
        models={models}
        modelsPending={false}
        onSettingsChange={setSettings}
        selectedModel={models.find((model) => model.id === settings.model)}
        selectedReasoningEffort={settings.reasoningEffort}
      />
    </I18nextProvider>
  );
}

it("selects model and reasoning effort from separate dropdowns", async () => {
  await i18n.changeLanguage("zh-CN");
  const screen = await render(<SelectorHarness />);
  const modelTrigger = screen.getByRole("button", { name: "选择模型：Model A" });
  const effortTrigger = screen.getByRole("button", { name: "选择思考量：高" });
  await expect.element(modelTrigger).toBeVisible();
  await expect.element(effortTrigger).toBeVisible();

  await modelTrigger.click();
  await screen
    .getByRole("menu", { name: "选择模型" })
    .getByRole("menuitemradio", { name: "Model B" })
    .click();
  await expect.element(screen.getByRole("button", { name: "选择模型：Model B" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "选择思考量：中" })).toBeVisible();

  await screen.getByRole("button", { name: "选择思考量：中" }).click();
  const effortMenu = screen.getByRole("menu", { name: "选择思考量" });
  await expect
    .element(effortMenu.getByRole("menuitemradio", { name: "高" }))
    .not.toBeInTheDocument();
  await effortMenu.getByRole("menuitemradio", { name: "低" }).click();
  await expect.element(screen.getByRole("button", { name: "选择思考量：低" })).toBeVisible();
});
