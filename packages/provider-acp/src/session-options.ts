import { SessionConfigOption } from "@agentclientprotocol/sdk/experimental/v2/unstable";
import type { AgentModelPage, AcpConfigOption } from "@codexly/protocol";

type SelectOptions = Extract<AcpConfigOption, { type: "select" }>["options"];

export function projectAcpConfig(options: SessionConfigOption[]): AcpConfigOption[] {
  // ACP v2 使用 configId 和 groupId，应用继续以持久化的选项标识读写旧设置。
  return options.flatMap((option): AcpConfigOption[] => {
    if (SessionConfigOption.isBoolean(option)) {
      const { configId: id, ...fields } = option;
      return [{ ...fields, id }];
    }
    if (!SessionConfigOption.isSelect(option)) return [];
    const { configId: id, options: entries, ...fields } = option;
    const first = entries[0];
    const grouped = first && "groupId" in first;
    const options = grouped
      ? entries.flatMap((entry) =>
          "groupId" in entry
            ? [
                {
                  group: entry.groupId,
                  name: entry.name,
                  options: entry.options,
                  ...(entry._meta === undefined ? {} : { _meta: entry._meta }),
                },
              ]
            : [],
        )
      : entries.flatMap((entry) => ("value" in entry ? [entry] : []));
    return [{ ...fields, id, options }];
  });
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
