import { useEffect, useState } from "react";
import type { AgentEngine, AgentModel } from "@codexly/protocol";
import { CLAUDE_MODEL_OPTIONS } from "@codexly/protocol";
import { useSelectedEngines } from "./engine-selection.js";
import { SettingsDropdown } from "./settings-dropdown.js";

const defaults = { codex: "gpt-6-luna", claude: "haiku" } as const;
const fallbackEngines: readonly AgentEngine[] = ["codex"];

/** 两端共用应用生成设置；只加载所选引擎的目录，不轮询、不逐模型探测。 */
export function DefaultGenerationSettings({
  settings,
  language,
  getModels,
  onChange,
}: Readonly<{
  settings: { defaultAgent?: AgentEngine; defaultModel: string };
  language: string;
  getModels: (engine: AgentEngine) => Promise<readonly AgentModel[]>;
  onChange: (patch: { defaultAgent: AgentEngine; defaultModel: string }) => void;
}>) {
  const engines = useSelectedEngines() ?? fallbackEngines;
  const engine = engines.includes(settings.defaultAgent ?? "codex")
    ? (settings.defaultAgent ?? "codex")
    : (engines[0] ?? "codex");
  const configuredModel =
    (settings.defaultAgent ?? "codex") === engine
      ? settings.defaultModel
      : engine === "claude"
        ? defaults.claude
        : defaults.codex;
  // Claude 的旧自定义值回落 Haiku，防止辅助生成的选择器重新补回已过滤的模型。
  const model =
    engine === "claude" && !CLAUDE_MODEL_OPTIONS.some((option) => option.id === configuredModel)
      ? defaults.claude
      : configuredModel;
  const [catalog, setCatalog] = useState<{ engine: AgentEngine; models: readonly AgentModel[] }>();
  useEffect(() => {
    let active = true;
    void getModels(engine)
      .then((models) => {
        if (active) setCatalog({ engine, models });
      })
      .catch(() => {
        if (active) setCatalog({ engine, models: [] });
      });
    return () => {
      active = false;
    };
  }, [engine, getModels]);
  // 单引擎安装自动持久化其默认值，后端生成不再依赖当前聊天的引擎。
  useEffect(() => {
    if (settings.defaultAgent !== engine || settings.defaultModel !== model)
      onChange({ defaultAgent: engine, defaultModel: model });
  }, [engine, model, settings.defaultAgent, settings.defaultModel, onChange]);
  const zh = language.startsWith("zh");
  const models = catalog?.engine === engine ? catalog.models : [];
  const choices =
    engine === "claude"
      ? CLAUDE_MODEL_OPTIONS.filter(
          (option) => models.length === 0 || models.some((entry) => entry.id === option.id),
        )
      : models.some((item) => item.id === model)
        ? models
        : [{ id: model, displayName: model }, ...models];
  const selectClass = "w-48 max-w-full";
  const agentLabel = zh ? "默认 Agent" : "Default agent";
  const modelLabel = zh ? "默认模型" : "Default model";
  return (
    <div className="divide-y divide-separator rounded-surface border border-separator bg-panel px-4">
      {engines.length > 1 ? (
        <div className="flex items-center justify-between gap-4 py-3">
          <span className="text-body-small font-medium">{agentLabel}</span>
          <SettingsDropdown
            label={agentLabel}
            className={selectClass}
            value={engine}
            options={engines.map((value) => ({
              value,
              label: value === "codex" ? "Codex" : "Claude",
            }))}
            onValueChange={(value) => {
              const defaultAgent = value as AgentEngine;
              onChange({
                defaultAgent,
                defaultModel: defaultAgent === "claude" ? defaults.claude : defaults.codex,
              });
            }}
          />
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-4 py-3">
        <span>
          <span className="text-body-small font-medium">{modelLabel}</span>
          <span className="mt-1 block text-label text-muted-foreground">
            {zh
              ? "供本应用生成任务标题、Git 提交信息和优化输入提示词。"
              : "Used by this app to generate task titles, Git commit messages, and optimize prompts."}
          </span>
        </span>
        <SettingsDropdown
          label={modelLabel}
          className={selectClass}
          value={model}
          options={choices.map((item) => ({ value: item.id, label: item.displayName }))}
          onValueChange={(value) => {
            onChange({ defaultAgent: engine, defaultModel: value });
          }}
        />
      </div>
    </div>
  );
}
