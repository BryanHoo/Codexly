function formatLocalDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function getArchivedTaskDeletionDate(months: 1 | 3 | 6 | 12, now = new Date()): string {
  // 先落到目标月份首日，再按该月天数截断，避免 3 月 31 日减一个月仍溢出到 3 月。
  const target = new Date(now.getFullYear(), now.getMonth() - months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(now.getDate(), lastDay));
  return formatLocalDate(target);
}

export function parseArchivedTaskDeletionDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  // 显式使用本地零点；直接解析 YYYY-MM-DD 会使用 UTC，导致两端展示与实际删除边界错位。
  const date = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(date.getTime()) || formatLocalDate(date) !== value) return null;
  return date.toISOString();
}
