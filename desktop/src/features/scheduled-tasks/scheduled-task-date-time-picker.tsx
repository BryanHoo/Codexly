import { enUS, zhCN } from "date-fns/locale";
import "../../i18n/scheduled-recurrence.js";
import { CalendarDays } from "lucide-react";
import DatePicker, { registerLocale } from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

import { useTranslation } from "../../i18n/i18n.js";
import { Input } from "../../shared/components/core/input.js";
import {
  resolveScheduledTaskLocale,
  toLocalDateTimeInput,
} from "./scheduled-task-schedule.js";

registerLocale("en", enUS);
registerLocale("zh-CN", zhCN);

function parseLocalDateTime(value: string): Date | null {
  // 调度字段保存本地墙钟时间，解析时不能转成 UTC，否则重复任务会偏移。
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function ScheduledTaskTimeInput({
  onChange,
  value = "",
}: Readonly<{
  onChange?: (value: string) => void;
  value?: string;
}>) {
  const { i18n, t } = useTranslation("workbench");
  const language = resolveScheduledTaskLocale(i18n.resolvedLanguage);

  return (
    <Input
      aria-label={t("scheduledTasks.timeOfDay")}
      lang={language}
      onChange={(event) => onChange?.(event.currentTarget.value)}
      step={60}
      type="time"
      value={value}
    />
  );
}

export function ScheduledTaskDateTimePicker({
  dateOnly = false,
  label,
  minimum,
  onChange,
  value,
}: Readonly<{
  dateOnly?: boolean;
  label?: string;
  minimum: string;
  onChange: (value: string) => void;
  value: string;
}>) {
  const { i18n, t } = useTranslation("workbench");
  const language = resolveScheduledTaskLocale(i18n.resolvedLanguage);
  const minimumDate = parseLocalDateTime(dateOnly && minimum ? `${minimum}T12:00` : minimum);
  const selectedDate = parseLocalDateTime(dateOnly && value ? `${value}T12:00` : value);

  return (
    <div className="scheduled-task-date-time-field">
      <DatePicker
        aria-label={label ?? t("scheduledTasks.time")}
        autoComplete="off"
        calendarClassName="scheduled-task-date-time-picker__calendar"
        chooseDayAriaLabelPrefix={t("scheduledTasks.chooseDate")}
        customTimeInput={<ScheduledTaskTimeInput />}
        customInput={<Input lang={language} type="text" />}
        dateFormat={dateOnly ? (language === "en" ? "MMM d, yyyy" : "yyyy年M月d日") : language === "en" ? "MMM d, yyyy, h:mm aa" : "yyyy年M月d日 HH:mm"}
        disabledDayAriaLabelPrefix={t("scheduledTasks.dateUnavailable")}
        dropdownMode="select"
        // 阻止库把 SVG 的 mousedown 当作外部点击；开关统一由随后的 click 处理。
        icon={<CalendarDays aria-hidden="true" onMouseDown={(event) => event.preventDefault()} />}
        locale={language}
        {...(minimumDate === null ? {} : { minDate: minimumDate })}
        nextMonthAriaLabel={t("scheduledTasks.nextMonth")}
        onChange={(date: Date | null) => {
          onChange(date === null ? "" : dateOnly ? toLocalDateTimeInput(date.getTime()).slice(0, 10) : toLocalDateTimeInput(date.getTime()));
        }}
        popperClassName="scheduled-task-date-time-picker__popper"
        popperPlacement="bottom-start"
        previousMonthAriaLabel={t("scheduledTasks.previousMonth")}
        selected={selectedDate}
        selectsMultiple={false}
        selectsRange={false}
        showIcon
        showMonthDropdown
        showPopperArrow={false}
        showTimeInput={!dateOnly}
        showYearDropdown
        strictParsing
        timeInputLabel={t("scheduledTasks.timeOfDay")}
        toggleCalendarOnIconClick
        wrapperClassName="scheduled-task-date-time-picker"
      />
    </div>
  );
}
