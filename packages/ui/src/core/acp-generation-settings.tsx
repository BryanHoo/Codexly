import { useQuery } from "@tanstack/react-query";
import type { AgentEngine } from "@codexly/protocol";
import { isAcpConfigOption } from "@codexly/protocol/acp-config-validation";
import type { AcpDefaultsClient } from "./acp-default-settings.js";
import { useSelectedEngines } from "./engine-selection.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select.js";
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
  const query = useQuery({
    queryKey: ["acp-defaults", engine ?? "unselected"],
    queryFn: ({ signal }) => {
      if (!engine) throw new Error("No generation agent selected");
      return client.getAcpDefaults(engine, { signal });
    },
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const modelOptions =
    query.data?.configOptions
      .filter(isAcpConfigOption)
      .filter((option) => option.category === "model" && option.type === "select") ?? [];
  const model = modelOptions.length === 1 ? modelOptions[0] : undefined;
  const raw =
    model?.type === "select"
      ? model.options.flatMap((option) => ("group" in option ? option.options : [option]))
      : [];
  const choices = [...new Map(raw.map((option) => [option.value, option])).values()];
  const configured = settings.defaultModel;
  const label =
    configured === null
      ? zh
        ? "沿用智能体默认"
        : "Use agent default"
      : (choices.find((option) => option.value === configured)?.name ?? configured);
  const selectClass = "w-48 max-w-[50%] text-body-small";
  return (
    <div className="space-y-2">
      <div className="divide-y divide-separator rounded-surface border border-separator bg-panel px-4">
        <div className="flex items-center justify-between gap-4 py-3">
          <span className="text-body-small font-medium">{zh ? "默认 Agent" : "Default agent"}</span>
          <Select
            value={engine ?? ""}
            onValueChange={(value) => {
              if (value === "codex" || value === "claude")
                onChange({ defaultAgent: value, defaultModel: null });
            }}
          >
            <SelectTrigger
              size="sm"
              className={selectClass}
              aria-label={zh ? "默认 Agent" : "Default agent"}
            >
              <SelectValue>{engine ?? (zh ? "请选择智能体" : "Choose agent")}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {engine && !enabled ? (
                <SelectItem disabled value={engine}>
                  {engine} ({zh ? "未启用" : "disabled"})
                </SelectItem>
              ) : null}
              {engines.map((value) => (
                <SelectItem key={value} value={value}>
                  {value === "codex" ? "Codex" : "Claude"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <span className="min-w-0 text-body-small font-medium">
            {zh ? "默认模型" : "Default model"}
            <span className="mt-1 block text-label font-normal text-muted-foreground">
              {zh
                ? "供任务标题、Git 提交信息和输入优化使用。"
                : "For task titles, Git commit messages and prompt optimization."}
            </span>
          </span>
          <Select
            disabled={!enabled}
            value={configured === null ? automatic : modelKey(configured)}
            onValueChange={(value) => {
              if (!engine) return;
              if (value === automatic) onChange({ defaultAgent: engine, defaultModel: null });
              else {
                const option = choices.find((option) => modelKey(option.value) === value);
                if (option) onChange({ defaultAgent: engine, defaultModel: option.value });
              }
            }}
          >
            <SelectTrigger
              size="sm"
              className={selectClass}
              aria-label={zh ? "默认模型" : "Default model"}
            >
              <SelectValue>
                <span className="block truncate">{label}</span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={automatic}>
                {zh ? "沿用智能体默认" : "Use agent default"}
              </SelectItem>
              {configured !== null && !choices.some((option) => option.value === configured) ? (
                <SelectItem disabled value={modelKey(configured)}>
                  {configured}
                </SelectItem>
              ) : null}
              {choices.map((option) => (
                <SelectItem
                  key={option.value}
                  value={modelKey(option.value)}
                  disabled={option.value.length === 0}
                >
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {!enabled ? (
        <p role="status" className="text-label text-muted-foreground">
          {zh
            ? "请选择已启用的智能体；已保存的选择会保留。"
            : "Choose an enabled agent; the saved selection is retained."}
        </p>
      ) : query.error ? (
        <div role="alert" className="text-label text-danger">
          {query.error.message}
          <Button variant="ghost" onClick={() => void query.refetch()}>
            {zh ? "重试" : "Retry"}
          </Button>
        </div>
      ) : !query.isPending && !model ? (
        <p role="status" className="text-label text-muted-foreground">
          {zh
            ? "智能体未提供可选模型，可沿用其默认值。"
            : "The agent provides no model choices; its default remains available."}
        </p>
      ) : null}
    </div>
  );
}
