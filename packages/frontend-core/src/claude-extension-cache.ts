import type { ClaudeExtensionMutation, ClaudeExtensionPage } from "@codexly/protocol";

/** 并行操作的完整目录响应可能乱序返回，只合并本次插件，保留其他操作已经确认的结果。 */
export function reconcileClaudeExtensionMutation(
  previous: ClaudeExtensionPage | undefined,
  response: ClaudeExtensionPage,
  input: ClaudeExtensionMutation,
  baseline?: ClaudeExtensionPage,
): ClaudeExtensionPage {
  if (!previous) return response;
  if (input.action === "sync") {
    if (previous === baseline) return response;
    // 同步目录期间也允许安装；保留同步开始后已确认的变更，防止旧目录响应回退安装状态。
    const key = (item: ClaudeExtensionPage["data"][number]) => `${item.id}:${item.scope}`;
    const before = new Map((baseline?.data ?? []).map((item) => [key(item), item]));
    const current = new Map(previous.data.map((item) => [key(item), item]));
    const changed = new Set(
      [...before.keys(), ...current.keys()].flatMap((id) => {
        const old = before.get(id),
          next = current.get(id);
        return old === next ? [] : [next?.id ?? old?.id];
      }),
    );
    return {
      data: [
        ...response.data.filter((item) => !changed.has(item.id)),
        ...previous.data.filter((item) => changed.has(item.id)),
      ],
    };
  }
  const updates = response.data.filter((item) => item.id === input.id);
  const index = previous.data.findIndex((item) => item.id === input.id);
  if (index < 0) return { data: [...previous.data, ...updates] };
  return {
    data: [
      ...previous.data.slice(0, index),
      ...updates,
      ...previous.data.slice(index).filter((item) => item.id !== input.id),
    ],
  };
}
