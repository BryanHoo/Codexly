import { useMemo, useState } from "react";
import { useTranslation } from "../../i18n/i18n.js";
import { SCHEDULE_WEEKDAYS, scheduleFrequency, resolveScheduledTaskLocale, type ScheduleDraft } from "./scheduled-task-schedule.js";

export function ScheduledTaskPreview({ schedule, timezone, dates, pending, failed, retry, error }: Readonly<{
  schedule: ScheduleDraft; timezone: string; dates: readonly number[] | undefined;
  pending: boolean; failed: boolean; retry: () => void; error: string | undefined;
}>) {
  const { i18n, t } = useTranslation("workbench");
  const [expanded, setExpanded] = useState(false);
  const language = resolveScheduledTaskLocale(i18n.resolvedLanguage);
  const formatter = useMemo(() => new Intl.DateTimeFormat(language, {
    timeZone: timezone, year: "numeric", month: "short", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }), [language, timezone]);
  const weekdays = useMemo(() => {
    const names = new Intl.DateTimeFormat(language, { timeZone: "UTC", weekday: "short" });
    return SCHEDULE_WEEKDAYS.map((_, index) => names.format(Date.UTC(2024, 0, index + 1)));
  }, [language]);
  const zoneName = useMemo(() => new Intl.DateTimeFormat(language, { timeZone: timezone, timeZoneName: "longGeneric" })
    .formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value, [language, timezone]);
  if (error) return <p className="scheduled-task-error" role="alert">{t(`scheduledTasks.${error}`)}</p>;
  const frequency = scheduleFrequency(schedule);
  const interval = schedule.preset === "custom" ? schedule.interval : 1;
  let rule = t("scheduledTasks.summaryEvery", { interval, unit: t(`scheduledTasks.units.${frequency}`) });
  if (schedule.preset === "weekdays" || schedule.preset === "weekends") rule = t(`scheduledTasks.${schedule.preset}`);
  else if (frequency === "WEEKLY") rule += ` · ${SCHEDULE_WEEKDAYS.filter((day) => schedule.weekdays.includes(day)).map((day) => weekdays[SCHEDULE_WEEKDAYS.indexOf(day)]).join("、")}`;
  if (frequency === "MONTHLY") {
    if (schedule.monthMode === "date") {
      const days = schedule.monthDays.filter((day) => day !== -1).join("、");
      rule += ` · ${[days ? t("scheduledTasks.summaryMonthDates", { days }) : "", schedule.monthDays.includes(-1) ? t("scheduledTasks.lastDay") : ""].filter(Boolean).join("、")}`;
    } else rule += ` · ${schedule.ordinals.map((n) => t(`scheduledTasks.ordinals.${n}`)).join("、")} ${weekdays[SCHEDULE_WEEKDAYS.indexOf(schedule.monthWeekday)]}`;
  }
  if (frequency === "YEARLY") rule += ` · ${t("scheduledTasks.summaryYearDate", { month: schedule.yearMonth, day: schedule.yearDay })}`;
  const summary = schedule.preset === "once" ? t("scheduledTasks.once") : frequency === "HOURLY" ? rule : t("scheduledTasks.summaryAt", { rule, time: schedule.time });
  return <div className="scheduled-task-preview" aria-live="polite" aria-busy={pending}>
    <p className="scheduled-task-preview__summary">{summary}</p>
    <p className="scheduled-task-preview__meta">{zoneName}{schedule.preset !== "once" ? ` · ${t("scheduledTasks.summaryFrom", { date: schedule.startDate })}${frequency === "HOURLY" ? ` ${schedule.time}` : ""}` : ""}</p>
    {schedule.preset !== "once" && schedule.endMode !== "never" ? <p className="scheduled-task-preview__meta">
      {schedule.endMode === "date" ? t("scheduledTasks.summaryUntil", { date: schedule.endDate }) : t("scheduledTasks.summaryCount", { count: schedule.count })}
    </p> : null}
    {schedule.preset === "custom" ? <p className="scheduled-task-preview__meta">{t("scheduledTasks.startHint")}</p> : null}
    <h4>{t("scheduledTasks.preview")}</h4>
    {pending ? <p>{t("scheduledTasks.previewLoading")}</p> : failed ? <>
      <p>{t("scheduledTasks.previewFailed")}</p><button type="button" onClick={retry}>{t("scheduledTasks.retryPreview")}</button>
    </> : dates?.length === 0 ? <p>{t("scheduledTasks.noFutureRuns")}</p> : <>
      <ol>{dates?.slice(0, expanded ? 5 : 3).map((date) => <li key={date}><time dateTime={new Date(date).toISOString()}>{formatter.format(date)}</time></li>)}</ol>
      {(dates?.length ?? 0) > 3 ? <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{t(expanded ? "scheduledTasks.showLess" : "scheduledTasks.showMore")}</button> : null}
    </>}
  </div>;
}
