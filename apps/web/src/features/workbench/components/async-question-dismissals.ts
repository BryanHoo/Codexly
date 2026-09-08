const storageKey = (scope: string) => `codexly:async-questions:dismissed:v1:${scope}`;

export function readQuestionDismissals(scope: string): ReadonlySet<string> {
  try {
    const value: unknown = JSON.parse(globalThis.localStorage.getItem(storageKey(scope)) ?? "[]");
    if (Array.isArray(value) && value.every((key): key is string => typeof key === "string")) {
      return new Set(value);
    }
  } catch {
    // 存储不可用或数据损坏时仍允许用户查看、回答与关闭问题。
  }
  return new Set();
}

export function saveQuestionDismissals(
  scope: string,
  keys: ReadonlySet<string>,
): ReadonlySet<string> {
  // 合并已有记录，避免后续关闭覆盖历史记录或其他标签页保存的结果。
  const dismissed = new Set([...readQuestionDismissals(scope), ...keys]);
  try {
    globalThis.localStorage.setItem(storageKey(scope), JSON.stringify([...dismissed]));
  } catch {
    // 配额不足时保留当前页面的关闭状态，不阻断交互。
  }
  return dismissed;
}
