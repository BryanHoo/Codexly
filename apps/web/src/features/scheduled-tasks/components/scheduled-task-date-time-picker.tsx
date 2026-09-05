import { enUS, zhCN } from "date-fns/locale";
import { CalendarDays } from "lucide-react";
import DatePicker, { registerLocale } from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

import { useTranslation } from "../../../i18n/i18n.js";
import { Input } from "../../../shared/components/core/input.js";
import { toLocalDateTimeInput } from "../scheduled-task-schedule.js";

registerLocale("en", enUS);
registerLocale("zh-CN", zhCN);

function parseLocalDateTime(value: string): Date | null {
  // 调度字段保存本地墙钟时间，不能先转 UTC，否则重复任务会发生时区偏移。
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function ScheduledTaskTimeInput({
  onChange,
  value = "",
}: Readonly<{ onChange?: (value: string) => void; value?: string }>) {
  const { i18n, t } = useTranslation("workbench");
  return (
    <Input
      aria-label={t("scheduledTasks.timeOfDay")}
      lang={i18n.resolvedLanguage === "en" ? "en" : "zh-CN"}
      onChange={(event) => onChange?.(event.currentTarget.value)}
      step={60}
      type="time"
      value={value}
    />
  );
}

export function ScheduledTaskDateTimePicker({
  minimum,
  onChange,
  value,
}: Readonly<{ minimum: string; onChange: (value: string) => void; value: string }>) {
  const { i18n, t } = useTranslation("workbench");
  const language = i18n.resolvedLanguage === "en" ? "en" : "zh-CN";
  const minimumDate = parseLocalDateTime(minimum);
  return (
    <DatePicker
      aria-label={t("scheduledTasks.time")}
      autoComplete="off"
      calendarClassName="scheduled-task-calendar"
      chooseDayAriaLabelPrefix={t("scheduledTasks.chooseDate")}
      customTimeInput={<ScheduledTaskTimeInput />}
      customInput={<Input lang={language} type="text" />}
      dateFormat={language === "en" ? "MMM d, yyyy, h:mm aa" : "yyyy年M月d日 HH:mm"}
      disabledDayAriaLabelPrefix={t("scheduledTasks.dateUnavailable")}
      dropdownMode="select"
      icon={<CalendarDays aria-hidden="true" />}
      locale={language}
      {...(minimumDate === null ? {} : { minDate: minimumDate })}
      nextMonthAriaLabel={t("scheduledTasks.nextMonth")}
      onChange={(date: Date | null) => {
        if (date !== null) onChange(toLocalDateTimeInput(date.getTime()));
      }}
      popperClassName="scheduled-task-calendar-popper"
      popperPlacement="bottom-start"
      previousMonthAriaLabel={t("scheduledTasks.previousMonth")}
      selected={parseLocalDateTime(value)}
      showIcon
      showMonthDropdown
      showPopperArrow={false}
      showTimeInput
      showYearDropdown
      strictParsing
      timeInputLabel={t("scheduledTasks.timeOfDay")}
      toggleCalendarOnIconClick
      wrapperClassName="scheduled-task-date-picker"
    />
  );
}
