import { useContext } from "react";
import { AcpStartupCacheContext, useAcpPreviewCatalog } from "./acp-preview-cache.js";
import { SettingsActions } from "./settings-group.js";
import { isAgentEngine, agentEngineName } from "@codexly/protocol";
import { useQuery } from "@tanstack/react-query";
import type { AgentEngine } from "@codexly/protocol";
import { isAcpConfigOption } from "@codexly/protocol/acp-config-validation";
import type { AcpDefaultsClient } from "./acp-default-settings.js";
import { useSelectedEngines } from "./engine-selection.js";
import { SettingsDropdown } from "./settings-dropdown.js";
import { Button } from "./button.js";

const fallbackEngines: readonly AgentEngine[] = ["codex"];
const automatic = JSON.stringify(["default"]);
const modelKey = (id: string) => JSON.stringify(["model", id]);

/** 辅助生成只选择 agent 公布的原始模型；初次挂载和引擎可用性变化绝不自动保存。 */
export function AcpGenerationSettings({
  client,
  settings,
  language,
  onChange,
}: Readonly<{
  client: Pick<AcpDefaultsClient, "getAcpDefaults">;
  settings: { defaultAgent?: AgentEngine; defaultModel: string | null };
  language: string;
  onChange: (patch: { defaultAgent: AgentEngine; defaultModel: string | null }) => void;
}>) {
  const engines = useSelectedEngines() ?? fallbackEngines,
    engine = settings.defaultAgent;
  const enabled = engine !== undefined && engines.includes(engine),
    zh = language.startsWith("zh");
  const useStartupCache = useContext(AcpStartupCacheContext);
  const catalog = useAcpPreviewCatalog();
  const cached = engine ? catalog[engine] : undefined;
  const query = useQuery({
    queryKey: ["acp-defaults", engine ?? "unselected"],
    queryFn: ({ signal }) => {
      if (!engine) throw new Error("No generation agent selected");
      return client.getAcpDefaults(engine, { signal });
    },
    enabled: enabled && !useStartupCache,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const configOptions = useStartupCache ? cached?.configOptions : query.data?.configOptions;
  const modelOptions = (configOptions ?? [])
    .filter(isAcpConfigOption)
    .filter((option) => option.category === "model" && option.type === "select");
  const model = modelOptions.length === 1 ? modelOptions[0] : undefined;
  const raw =
    model?.type === "select"
      ? model.options.flatMap((option) => ("group" in option ? option.options : [option]))
      : [];
  const choices = [...new Map(raw.map((option) => [option.value, option])).values()];
  const configured = settings.defaultModel;
  const agentLabel = zh ? "默认 Agent" : "Default agent";
  const modelLabel = zh ? "默认模型" : "Default model";
  const selectClass = "w-48 max-w-[50%]";
  return (
    <div className="space-y-2">
      <div className="divide-y divide-separator rounded-surface border border-separator bg-panel px-4">
        <div className="flex items-center justify-between gap-4 py-3">
          <span className="text-body-small font-medium">{agentLabel}</span>
          <SettingsDropdown
            label={agentLabel}
            valueLabel={engine ?? (zh ? "请选择智能体" : "Choose agent")}
            className={selectClass}
            value={engine ?? ""}
            options={[
              ...(engine && !enabled
                ? [
                    {
                      value: engine,
                      label: `${engine} (${zh ? "未启用" : "disabled"})`,
                      disabled: true,
                    },
                  ]
                : []),
              ...engines.map((value) => ({ value, label: agentEngineName(value) })),
            ]}
            onValueChange={(value) => {
              if (isAgentEngine(value)) onChange({ defaultAgent: value, defaultModel: null });
            }}
          />
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <span className="min-w-0 text-body-small font-medium">
            {modelLabel}
            <span className="mt-1 block text-label font-normal text-muted-foreground">
              {zh
                ? "供任务标题、Git 提交信息和输入优化使用。"
                : "For task titles, Git commit messages and prompt optimization."}
            </span>
          </span>
          <SettingsDropdown
            label={modelLabel}
            className={selectClass}
            disabled={!enabled}
            value={configured === null ? automatic : modelKey(configured)}
            options={[
              { value: automatic, label: zh ? "沿用智能体默认" : "Use agent default" },
              ...(configured !== null && !choices.some((option) => option.value === configured)
                ? [{ value: modelKey(configured), label: configured, disabled: true }]
                : []),
              ...choices.map((option) => ({
                value: modelKey(option.value),
                label: option.name,
                disabled: option.value.length === 0,
              })),
            ]}
            onValueChange={(value) => {
              if (!engine) return;
              if (value === automatic) onChange({ defaultAgent: engine, defaultModel: null });
              else {
                const option = choices.find((option) => modelKey(option.value) === value);
                if (option) onChange({ defaultAgent: engine, defaultModel: option.value });
              }
            }}
          />
        </div>
      </div>
      {!enabled ? (
        <p role="status" className="text-label text-muted-foreground">
          {zh
            ? "请选择已启用的智能体；已保存的选择会保留。"
            : "Choose an enabled agent; the saved selection is retained."}
        </p>
      ) : !useStartupCache && query.error ? (
        <div role="alert" className="text-label text-danger">
          {query.error.message}
          <SettingsActions>
            <Button variant="ghost" onClick={() => void query.refetch()}>
              {zh ? "重试" : "Retry"}
            </Button>
          </SettingsActions>
        </div>
      ) : (useStartupCache || !query.isPending) && !model ? (
        <p role="status" className="text-label text-muted-foreground">
          {zh
            ? "智能体未提供可选模型，可沿用其默认值。"
            : "The agent provides no model choices; its default remains available."}
        </p>
      ) : null}
    </div>
  );
}
