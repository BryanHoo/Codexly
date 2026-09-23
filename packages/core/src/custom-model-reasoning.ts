import type { AgentModel, AgentModelPage } from "@codexly/protocol";

export const CUSTOM_MODEL_REASONING_FALLBACK = [
  { description: "", id: "low" },
  { description: "", id: "medium" },
  { description: "", id: "high" },
] as const satisfies AgentModel["supportedReasoningEfforts"];

function needsReasoningFallback(model: AgentModel): boolean {
  return (
    model.supportedReasoningEfforts.length === 0 ||
    model.supportedReasoningEfforts.every((effort) => effort.id === "none")
  );
}

export function normalizeCustomModelReasoning<T extends AgentModelPage>(page: T): T {
  if (!page.data.some(needsReasoningFallback)) return page;
  const data = page.data.map((model) => {
    if (!needsReasoningFallback(model)) return model;
    // 标准 OpenAI /models 不携带推理元数据；自定义 Provider 使用稳定的基础档位。
    return {
      ...model,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: CUSTOM_MODEL_REASONING_FALLBACK.map((effort) => ({ ...effort })),
    };
  });
  return { ...page, data };
}
