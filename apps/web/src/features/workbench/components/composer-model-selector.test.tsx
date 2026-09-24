import type { AgentModel, AgentTaskSettings } from "@codexly/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ComposerModelSelector,
  resolveComposerModelSelection,
  resolveComposerReasoningSelection,
} from "./composer-model-selector.js";

const models: readonly AgentModel[] = [
  {
    defaultReasoningEffort: "high",
    description: "适合复杂编码任务",
    displayName: "GPT-5.6 Sol",
    id: "gpt-5.6-sol",
    isDefault: true,
    supportedReasoningEfforts: [
      { description: "快速回答", id: "low" },
      { description: "深入分析", id: "high" },
    ],
  },
  {
    defaultReasoningEffort: "medium",
    description: "适合日常编码任务",
    displayName: "GPT-5.6 Terra",
    id: "gpt-5.6-terra",
    isDefault: false,
    supportedReasoningEfforts: [
      { description: "快速回答", id: "low" },
      { description: "平衡速度与深度", id: "medium" },
    ],
  },
];

const settings: AgentTaskSettings = {
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  sandboxMode: "workspace-write",
};

describe("ComposerModelSelector", () => {
  it("分别展示模型和思考量的下拉触发器", () => {
    const markup = renderToStaticMarkup(
      <ComposerModelSelector
        activeSettings={settings}
        disabled={false}
        models={models}
        modelsPending={false}
        onSettingsChange={vi.fn()}
        selectedModel={models[0]}
        selectedReasoningEffort="high"
      />,
    );

    expect(markup).toContain('aria-label="选择模型：GPT-5.6 Sol"');
    expect(markup).toContain('aria-label="选择思考量：高"');
    expect(markup).toContain('data-slot="composer-model-selector"');
    expect(markup).toContain('data-slot="composer-reasoning-selector"');
    expect(markup.match(/aria-haspopup="menu"/gu)).toHaveLength(2);
    expect(markup).not.toContain("dropdown-menu-sub-trigger");
    expect(markup).toContain("GPT-5.6 Sol");
    expect(markup).toContain("高");
    expect(markup).toContain("模型");
    expect(markup).toContain("思考量");
  });

  it("切换模型时回落到目标模型支持的默认思考量", () => {
    expect(resolveComposerModelSelection(models, settings, "gpt-5.6-terra")).toEqual({
      ...settings,
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
    });
    expect(resolveComposerModelSelection(models, settings, "missing")).toBeUndefined();
  });

  it("只接受当前模型支持的思考量", () => {
    expect(resolveComposerReasoningSelection(models[0], settings, "low")).toEqual({
      ...settings,
      reasoningEffort: "low",
    });
    expect(resolveComposerReasoningSelection(models[0], settings, "medium")).toBeUndefined();
    expect(resolveComposerReasoningSelection(undefined, settings, "low")).toBeUndefined();
  });
});
