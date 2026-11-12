import { useState } from "react";
import type { AcpPlanScheduleField } from "@codexly/ui/core/acp-plan-contract";
import { ScheduledTaskScheduleFields } from "./components/scheduled-task-schedule-fields.js";
import { scheduleToDraft, draftToSchedule } from "./scheduled-task-schedule.js";
// 保留原规则直到用户显式编辑，普通改名不能重算已结束计划。
export const AcpPlanScheduleFieldAdapter: AcpPlanScheduleField = ({
  value,
  disabled,
  onChange,
}) => {
  const [draft, setDraft] = useState(() => scheduleToDraft(value));
  const [timezone] = useState(() =>
    value.type === "rrule"
      ? value.timezone
      : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  return (
    <fieldset disabled={disabled}>
      <ScheduledTaskScheduleFields
        schedule={draft}
        onChange={(next) => {
          setDraft(next);
          onChange(draftToSchedule(next, timezone));
        }}
      />
    </fieldset>
  );
};
