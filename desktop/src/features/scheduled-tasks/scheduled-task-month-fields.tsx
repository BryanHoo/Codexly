import { useTranslation } from "../../i18n/i18n.js";
import { SCHEDULE_WEEKDAYS, scheduleFrequency, type ScheduleDraft, type ScheduleWeekday } from "./scheduled-task-schedule.js";
import type { ScheduleFieldsProps } from "./scheduled-task-schedule-fields.js";

const MONTH_DAYS = Array.from({ length: 31 }, (_, index) => index + 1);
const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);
const ORDINALS = [1, 2, 3, 4, 5, -1] as const;

function toggle(values: readonly number[], value: number): readonly number[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function ScheduledTaskMonthFields({ schedule, onChange, weekdayNames }: ScheduleFieldsProps & Readonly<{ weekdayNames: readonly string[] }>) {
  const { t } = useTranslation("workbench");
  const patch = (value: Partial<ScheduleDraft>) => onChange({ ...schedule, ...value });
  if (scheduleFrequency(schedule) === "YEARLY") return <>
    <label><span>{t("scheduledTasks.yearMonth")}</span><select value={schedule.yearMonth}
      onChange={(event) => patch({ yearMonth: Number(event.currentTarget.value) })}>
      {MONTHS.map((month) => <option key={month} value={month}>{month}</option>)}
    </select></label>
    <label><span>{t("scheduledTasks.yearDay")}</span><select value={schedule.yearDay}
      onChange={(event) => patch({ yearDay: Number(event.currentTarget.value) })}>
      {MONTH_DAYS.map((day) => <option key={day} value={day}>{day}</option>)}
    </select></label>
    {schedule.yearMonth === 2 && schedule.yearDay === 29 ? <p className="scheduled-task-hint">{t("scheduledTasks.leapHint")}</p> : null}
  </>;
  return <>
    <label><span>{t("scheduledTasks.monthMode")}</span><select value={schedule.monthMode}
      onChange={(event) => patch({ monthMode: event.currentTarget.value as ScheduleDraft["monthMode"] })}>
      <option value="date">{t("scheduledTasks.byDate")}</option><option value="weekday">{t("scheduledTasks.byWeekday")}</option>
    </select></label>
    {schedule.monthMode === "date" ? <div className="scheduled-task-field scheduled-task-field--choices">
      <span>{t("scheduledTasks.monthDay")}</span><div className="scheduled-task-month-days" role="group" aria-label={t("scheduledTasks.monthDay")}>
        {MONTH_DAYS.map((day) => <button key={day} type="button" aria-pressed={schedule.monthDays.includes(day)}
          onClick={() => patch({ monthDays: toggle(schedule.monthDays, day) })}>{day}</button>)}
        <button className="scheduled-task-month-days__last" type="button" aria-pressed={schedule.monthDays.includes(-1)}
          onClick={() => patch({ monthDays: toggle(schedule.monthDays, -1) })}>{t("scheduledTasks.lastDay")}</button>
      </div>
    </div> : <>
      <div className="scheduled-task-field scheduled-task-field--choices"><span>{t("scheduledTasks.ordinal")}</span>
        <div className="scheduled-task-choices" role="group" aria-label={t("scheduledTasks.ordinal")}>
          {ORDINALS.map((n) => <button key={n} type="button" aria-pressed={schedule.ordinals.includes(n)}
            onClick={() => patch({ ordinals: toggle(schedule.ordinals, n) })}>{t(`scheduledTasks.ordinals.${n}`)}</button>)}
        </div>
      </div>
      <label><span>{t("scheduledTasks.weekday")}</span><select value={schedule.monthWeekday}
        onChange={(event) => patch({ monthWeekday: event.currentTarget.value as ScheduleWeekday })}>
        {SCHEDULE_WEEKDAYS.map((day, index) => <option key={day} value={day}>{weekdayNames[index]}</option>)}
      </select></label>
    </>}
    {schedule.monthMode === "date" && schedule.monthDays.some((day) => day >= 29) ? <p className="scheduled-task-hint">{t("scheduledTasks.monthSkipHint")}</p> : null}
    {schedule.monthMode === "weekday" && schedule.ordinals.includes(5) ? <p className="scheduled-task-hint">{t("scheduledTasks.ordinalSkipHint")}</p> : null}
  </>;
}
