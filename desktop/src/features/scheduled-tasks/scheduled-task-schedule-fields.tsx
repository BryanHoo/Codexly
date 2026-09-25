import { lazy, memo, Suspense, useMemo, useState } from "react";
import "../../i18n/scheduled-recurrence.js";
import { useTranslation } from "../../i18n/i18n.js";
import { Input } from "../../shared/components/core/input.js";
import { SCHEDULE_FREQUENCIES, SCHEDULE_WEEKDAYS, resolveScheduledTaskLocale, scheduleFrequency,
  toLocalDateTimeInput, type ScheduleDraft, type SchedulePreset, type ScheduleFrequency } from "./scheduled-task-schedule.js";
import { ScheduledTaskMonthFields } from "./scheduled-task-month-fields.js";

// 日历仍按需拆包；常用每天和每周设置不提前加载日期控件。
const DateTimePicker = lazy(async () => {
  const module = await import("./scheduled-task-date-time-picker.js");
  return { default: module.ScheduledTaskDateTimePicker };
});

export type ScheduleFieldsProps = Readonly<{ schedule: ScheduleDraft; onChange: (draft: ScheduleDraft) => void }>;

export function ScheduleDateField({ label, value, onChange, minimum = "", dateOnly = true }: Readonly<{
  label: string; value: string; onChange: (value: string) => void; minimum?: string; dateOnly?: boolean;
}>) {
  return <div className="scheduled-task-field">
    <span>{label}</span>
    <Suspense fallback={<Input aria-label={label} aria-busy="true" disabled value="" />}>
      <DateTimePicker dateOnly={dateOnly} label={label} minimum={minimum} onChange={onChange} value={value} />
    </Suspense>
  </div>;
}

export const ScheduledTaskScheduleFields = memo(function ScheduledTaskScheduleFields({ schedule, onChange }: ScheduleFieldsProps) {
  const { i18n, t } = useTranslation("workbench");
  const [minimum] = useState(() => toLocalDateTimeInput(Date.now()));
  const [rangeExpanded, setRangeExpanded] = useState(schedule.endMode !== "never");
  const frequency = scheduleFrequency(schedule);
  const language = resolveScheduledTaskLocale(i18n.resolvedLanguage);
  const weekdayNames = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(language, { timeZone: "UTC", weekday: "short" });
    return SCHEDULE_WEEKDAYS.map((_, index) => formatter.format(new Date(Date.UTC(2024, 0, index + 1))));
  }, [language]);
  const patch = (value: Partial<ScheduleDraft>) => onChange({ ...schedule, ...value });

  return <>
    <label><span>{t("scheduledTasks.repeat")}</span><select
      onChange={(event) => patch({ preset: event.currentTarget.value as SchedulePreset, frequency, unsupported: false })}
      value={schedule.preset}>
      {(["once", "daily", "weekdays", "weekends", "weekly", "monthly", "custom"] as const).map((preset) =>
        <option key={preset} value={preset}>{t(`scheduledTasks.${preset}`)}</option>)}
    </select></label>
    {schedule.preset === "once" ? <ScheduleDateField dateOnly={false} label={t("scheduledTasks.time")}
      minimum={minimum} value={schedule.dateTime} onChange={(dateTime) => patch({ dateTime })} /> : <>
      {schedule.preset === "custom" ? <div className="scheduled-task-field">
        <span>{t("scheduledTasks.every")}</span><div className="scheduled-task-inline-controls">
          <Input aria-label={t("scheduledTasks.interval")} type="number" min={1} max={999} step={1}
            value={Number.isNaN(schedule.interval) ? "" : schedule.interval}
            onChange={(event) => patch({ interval: event.currentTarget.valueAsNumber })} />
          <select aria-label={t("scheduledTasks.intervalUnit")} value={schedule.frequency}
            onChange={(event) => patch({ frequency: event.currentTarget.value as ScheduleFrequency })}>
            {SCHEDULE_FREQUENCIES.map((unit) => <option key={unit} value={unit}>{t(`scheduledTasks.units.${unit}`)}</option>)}
          </select>
        </div>
      </div> : null}
      {frequency === "WEEKLY" && schedule.preset !== "weekdays" && schedule.preset !== "weekends" ? <div className="scheduled-task-field scheduled-task-field--choices">
        <span>{t("scheduledTasks.repeatDays")}</span><div className="scheduled-task-choices" role="group" aria-label={t("scheduledTasks.repeatDays")}>
          {SCHEDULE_WEEKDAYS.map((day, index) => <button key={day} type="button" aria-pressed={schedule.weekdays.includes(day)}
            onClick={() => patch({ weekdays: schedule.weekdays.includes(day) ? schedule.weekdays.filter((value) => value !== day) : [...schedule.weekdays, day] })}>
            {weekdayNames[index]}</button>)}
        </div>
      </div> : null}
      {frequency === "MONTHLY" || frequency === "YEARLY" ? <ScheduledTaskMonthFields schedule={schedule} onChange={onChange} weekdayNames={weekdayNames} /> : null}
      <label><span>{t("scheduledTasks.timeOfDay")}</span><Input step={60} type="time" value={schedule.time}
        onChange={(event) => patch({ time: event.currentTarget.value })} /></label>
      {schedule.preset !== "custom" ? <button className="scheduled-task-range-toggle" type="button" aria-expanded={rangeExpanded}
        onClick={() => setRangeExpanded(!rangeExpanded)}>{t("scheduledTasks.rangeSettings")}</button> : null}
      {schedule.preset === "custom" || rangeExpanded ? <>
      <ScheduleDateField label={t("scheduledTasks.startDate")} value={schedule.startDate} onChange={(startDate) => patch({ startDate })} />
      <label><span>{t("scheduledTasks.end")}</span><select value={schedule.endMode}
        onChange={(event) => patch({ endMode: event.currentTarget.value as ScheduleDraft["endMode"] })}>
        <option value="never">{t("scheduledTasks.never")}</option>
        <option value="date">{t("scheduledTasks.onDate")}</option>
        <option value="count">{t("scheduledTasks.afterCount")}</option>
      </select></label>
      {schedule.endMode === "date" ? <ScheduleDateField label={t("scheduledTasks.endDate")} minimum={schedule.startDate}
        value={schedule.endDate} onChange={(endDate) => patch({ endDate })} /> : null}
      {schedule.endMode === "count" ? <label><span>{t("scheduledTasks.count")}</span><Input type="number" min={1} max={10000} step={1}
        value={Number.isNaN(schedule.count) ? "" : schedule.count} onChange={(event) => patch({ count: event.currentTarget.valueAsNumber })} /></label> : null}
      {schedule.endMode === "count" ? <p className="scheduled-task-hint">{t("scheduledTasks.countHint")}</p> : null}
      </> : null}
    </>}
  </>;
});
