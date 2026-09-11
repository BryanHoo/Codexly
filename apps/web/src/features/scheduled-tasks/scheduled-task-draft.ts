export type SchedulePreset =
  "once" | "daily" | "weekdays" | "weekends" | "weekly" | "monthly" | "custom";
export const SCHEDULE_WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export const SCHEDULE_FREQUENCIES = ["HOURLY", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;
export type ScheduleWeekday = (typeof SCHEDULE_WEEKDAYS)[number];
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];
export type ScheduleDraft = Readonly<{
  dateTime: string;
  preset: SchedulePreset;
  frequency: ScheduleFrequency;
  interval: number;
  time: string;
  startDate: string;
  weekdays: readonly ScheduleWeekday[];
  monthMode: "date" | "weekday";
  monthDays: readonly number[];
  ordinals: readonly number[];
  monthWeekday: ScheduleWeekday;
  yearMonth: number;
  yearDay: number;
  endMode: "never" | "date" | "count";
  endDate: string;
  count: number;
  // 已保存规则保留原始起点，不因编辑名称、提示词或重新保存而重置重复周期和次数。
  anchor?: Readonly<{ unixMs: number; startDate: string; time: string }>;
  unsupported?: boolean;
}>;

export type ScheduleFieldsProps = Readonly<{
  schedule: ScheduleDraft;
  onChange: (draft: ScheduleDraft) => void;
}>;
