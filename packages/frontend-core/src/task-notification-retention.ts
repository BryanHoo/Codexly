type NotificationSummary = Readonly<{ id: string; taskName: string; read: boolean }>;

export const MAX_TASK_NOTIFICATIONS = 500;
export const MAX_NOTIFICATION_TASKS = 512;
const HISTORY_BYTES = 256 * 1024;
const METADATA_BYTES = 128 * 1024;
const encoder = new TextEncoder();

/** 历史仅保存导航摘要；优先淘汰已读，再淘汰最旧未读，不改变任务本身的等待状态。 */
export function retainTaskNotifications<T extends NotificationSummary>(
  items: readonly T[],
): readonly T[] {
  let bytes = 0;
  const retained = new Set<T>();
  for (const read of [false, true]) {
    for (const item of items) {
      if (item.read !== read || retained.size >= MAX_TASK_NOTIFICATIONS) continue;
      const value =
        item.taskName.length > 256 ? { ...item, taskName: item.taskName.slice(0, 256) } : item;
      const size = encoder.encode(JSON.stringify(value)).byteLength + 1;
      if (bytes + size > HISTORY_BYTES) continue;
      bytes += size;
      retained.add(value);
    }
  }
  // 优先级只用于裁剪，展示继续保持原来的时间顺序。
  const ids = new Map([...retained].map((item) => [item.id, item]));
  const next = items.flatMap((item) => {
    const value = ids.get(item.id);
    return value ? [value] : [];
  });
  return next.length === items.length && next.every((item, index) => item === items[index])
    ? items
    : next;
}

/** 去重和水位都按最近使用保留；即使用户清空通知，也不会无限积累任务身份。 */
export function retainNotificationMetadata<T>(map: Map<string, T>): void {
  let bytes = 0;
  let count = 0;
  for (const [key, value] of [...map].reverse()) {
    const size = encoder.encode(JSON.stringify([key, value])).byteLength + 1;
    if (++count > MAX_NOTIFICATION_TASKS || bytes + size > METADATA_BYTES) map.delete(key);
    else bytes += size;
  }
}
