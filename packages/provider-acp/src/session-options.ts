import type {
  SessionConfigOption,
  SessionConfigSelectOption,
  SessionConfigSelectOptions,
} from "@agentclientprotocol/sdk/unstable";
import type { AgentModelPage } from "@codexly/protocol";
export function acpSelectOptions(options: SessionConfigSelectOptions): SessionConfigSelectOption[] {
  return options.flatMap((option) => ("group" in option ? option.options : [option]));
}
/** 只投影 agent 公布的模型与当前模型参数，不维护厂商模型别名或猜测其他模型能力。 */
export function acpModels(options: readonly SessionConfigOption[]): AgentModelPage {
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
