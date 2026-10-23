export const PROMPT_SUGGESTION_LIMIT = 12;
export type PromptSuggestion<T> = Readonly<{ value: T; terms: readonly string[] }>;

/** 索引在来源变化时构建；键入查询时复用已规范化的标题和搜索词。 */
export function createPromptSuggestion<T>(value: T, terms: readonly string[]): PromptSuggestion<T> {
  return { value, terms: terms.map((term) => term.trim().toLocaleLowerCase()) };
}

/** 只保留固定数量候选，不构造全量匹配数组或排序全部结果。 */
export function rankPromptSuggestions<T>(
  groups: readonly (readonly PromptSuggestion<T>[])[],
  query: string,
  limit = PROMPT_SUGGESTION_LIMIT,
): readonly T[] {
  if (limit <= 0) return [];
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    const result: T[] = [];
    // 默认按来源轮流取少量条目，防止大量自定义提示词挤掉内置命令和 Skills。
    for (let index = 0; result.length < limit; index++) {
      let found = false;
      for (const group of groups) {
        const entry = group[index];
        if (!entry) continue;
        result.push(entry.value);
        found = true;
        if (result.length === limit) break;
      }
      if (!found) break;
    }
    return result;
  }
  const best: { value: T; score: number }[] = [];
  for (const group of groups) {
    for (const entry of group) {
      let score = Infinity;
      for (const term of entry.terms) {
        if (term === normalized) {
          score = 0;
          break;
        }
        if (term.startsWith(normalized)) score = Math.min(score, 1);
        else if (term.includes(normalized)) score = Math.min(score, 2);
      }
      if (
        score === Infinity ||
        (best.length === limit && score >= (best.at(-1)?.score ?? Infinity))
      )
        continue;
      // 同分维持原顺序；最多移动 limit 个元素，额外空间始终为 O(limit)。
      const position = best.findIndex((candidate) => candidate.score > score);
      best.splice(position === -1 ? best.length : position, 0, { value: entry.value, score });
      if (best.length > limit) best.pop();
    }
  }
  return best.map((entry) => entry.value);
}
