import type { AgentModelPage } from "@codexly/protocol";

export function normalizeCustomModelReasoning<T extends AgentModelPage>(page: T): T {
  // 空目录表示能力未知，不能伪造档位或把明确的 none 改为低、中、高。
  // 空默认值在请求映射时转为 null，由当前 Provider 决定是否启用推理。
  if (
    !page.data.some(
      (model) =>
        model.supportedReasoningEfforts.length === 0 && model.defaultReasoningEffort !== "",
    )
  )
    return page;
  return {
    ...page,
    data: page.data.map((model) =>
      model.supportedReasoningEfforts.length === 0
        ? { ...model, defaultReasoningEffort: "" }
        : model,
    ),
  };
}
