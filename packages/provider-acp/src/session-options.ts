import type { SessionConfigOption } from "@agentclientprotocol/sdk/unstable";
import type { AgentModelPage, AcpConfigOption } from "@codexly/protocol";

type SelectOptions = Extract<AcpConfigOption, { type: "select" }>["options"];

/** v1 选项 ID 与应用持久化契约一致，保留 Agent 的原始顺序和值。 */
export function projectAcpConfig(options: SessionConfigOption[]): AcpConfigOption[] {
  return structuredClone(options);
}

export function acpSelectOptions(options: SelectOptions) {
  return options.flatMap((option) => ("group" in option ? option.options : [option]));
}
/** 只投影 agent 公布的模型与当前模型参数，不维护厂商模型别名或猜测其他模型能力。 */
export function acpModels(options: readonly AcpConfigOption[]): AgentModelPage {
  const model = options.find((option) => option.category === "model" && option.type === "select");
  const effort = options.find(
    (option) => option.category === "thought_level" && option.type === "select",
  );
  if (model?.type !== "select") return { data: [], nextCursor: null };
  return {
    data: acpSelectOptions(model.options).map((option) => ({
      id: option.value,
      displayName: option.name,
      description: option.description ?? "",
      isDefault: option.value === model.currentValue,
      defaultReasoningEffort:
        option.value === model.currentValue && effort?.type === "select" ? effort.currentValue : "",
      supportedReasoningEfforts:
        option.value === model.currentValue && effort?.type === "select"
          ? acpSelectOptions(effort.options).map((value) => ({
              id: value.value,
              description: value.description ?? value.name,
            }))
          : [],
    })),
    nextCursor: null,
  };
}
