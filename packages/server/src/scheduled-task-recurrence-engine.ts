import type { ScheduledTaskSchedule } from "@codexly/protocol";
import type * as WallTime from "@codexly/protocol";
import * as rrule from "rrule";
// Node 源码加载 CommonJS，打包器加载 ESM，统一两种模块的导出形状。
function normalizeModule(module: typeof rrule): Pick<typeof rrule, "RRule" | "rrulestr"> {
  return "default" in module ? module.default : module;
}
const { RRule, rrulestr } = normalizeModule(rrule);

const MIN_RECURRENCE_MS = 60_000;

export function previewScheduledTask(
  schedule: ScheduledTaskSchedule,
  afterUnixMs: number,
  limit: number,
  { wallTimeToUnix, zonedDateTime }: Pick<typeof WallTime, "wallTimeToUnix" | "zonedDateTime">,
): number[] {
  if (schedule.type === "once") return schedule.atUnixMs > afterUnixMs ? [schedule.atUnixMs] : [];
  const normalized = schedule.rrule.trim().replace(/^RRULE:/u, "");
  if (normalized === "" || /[\r\n]/u.test(normalized))
    throw new Error("Scheduled task RRULE is invalid");
  // RRULE 只计算墙钟日历；统一显式转换时区，避免库的 TZID 转换依赖服务进程时区。
  const start = zonedDateTime(schedule.startAtUnixMs, schedule.timezone).replace(/[-:]/gu, "");
  const rule = rrulestr(`DTSTART:${start}Z\nRRULE:${normalized}`, { cache: false });
  const until = rule.options.until?.getTime();
  const count = rule.options.count;
  if (!Number.isInteger(rule.options.interval) || rule.options.interval < 1)
    throw new Error("Scheduled task interval must be a positive integer");
  if (count !== null && (!Number.isInteger(count) || count < 1 || count > 10_000))
    throw new Error("Scheduled task count must be between 1 and 10000");
  if (until !== undefined) {
    // UNTIL 是绝对时间，转换到任务时区后再交给日历引擎作包含边界判断。
    rule.options.until = new Date(`${zonedDateTime(until, schedule.timezone)}Z`);
  }
  const first = rule.all((_date, index) => index < 2);
  if (
    first[0] !== undefined &&
    first[1] !== undefined &&
    first[1].getTime() - first[0].getTime() < MIN_RECURRENCE_MS
  ) {
    throw new Error("Scheduled task recurrence must be at least one minute");
  }
  if (until !== undefined && until <= afterUnixMs) return [];
  const dates: number[] = [];
  const afterWall = Date.parse(`${zonedDateTime(afterUnixMs, schedule.timezone)}Z`);
  // 留出夏令时回拨窗口；过滤和返回始终使用绝对时间，历史结果不保留在内存中。
  const lower = new Date(afterWall - 2 * 86_400_000);
  if (count === null) {
    const unit =
      rule.options.freq === RRule.HOURLY
        ? 3_600_000
        : rule.options.freq === RRule.DAILY
          ? 86_400_000
          : rule.options.freq === RRule.WEEKLY
            ? 7 * 86_400_000
            : undefined;
    if (unit !== undefined) {
      // 按完整周期跳过历史；保留原始相位和星期，不逐小时扫描多年历史。
      const step = unit * rule.options.interval;
      const anchor = rule.options.dtstart.getTime();
      const cycles = Math.max(0, Math.floor((lower.getTime() - anchor) / step));
      rule.options.dtstart = new Date(anchor + cycles * step);
    }
  }
  if (count !== null) {
    // 不存在的夏令时墙钟时间不算一次有效计划，COUNT 由转换后的结果计数。
    rule.options.count = null;
  }
  let occurrences = 0;
  const accept = (date: Date): boolean => {
    const unixMs = wallTimeToUnix(date.toISOString().slice(0, 19), schedule.timezone);
    if (unixMs === undefined) return true;
    if (unixMs < schedule.startAtUnixMs) return true;
    if (until !== undefined && unixMs > until) return false;
    occurrences += 1;
    if (unixMs > afterUnixMs) dates.push(unixMs);
    return dates.length < Math.min(limit, 5) && (count === null || occurrences < count);
  };
  if (count !== null) {
    // 有限规则从原始起点计数，避免每次预览或执行都重新获得完整次数。
    rule.between(rule.options.dtstart, new Date("9999-12-31T23:59:59Z"), true, accept);
  } else {
    rule.between(lower, new Date("9999-12-31T23:59:59Z"), true, accept);
  }
  return dates;
}
