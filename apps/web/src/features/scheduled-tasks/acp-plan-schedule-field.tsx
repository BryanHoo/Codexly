import { useMemo, useState } from "react";
import type { AcpPlanScheduleField } from "@codexly/ui/core/acp-plan-contract";
import { ScheduledTaskScheduleFields } from "./components/scheduled-task-schedule-fields.js";
import { ScheduledTaskPreview } from "./components/scheduled-task-preview.js";
import { useSchedulePreview } from "./use-schedule-preview.js";
import { scheduleToDraft, draftToSchedule, scheduleDraftError } from "./scheduled-task-schedule.js";

/** 保留原规则直到用户编辑，并复用历史频率字段和下一次执行预览。 */
export const AcpPlanScheduleFieldAdapter: AcpPlanScheduleField = ({
  value,
  disabled,
  preview,
  onChange,
}) => {
  const [draft, setDraft] = useState(() => scheduleToDraft(value));
  const [timezone] = useState(() =>
    value.type === "rrule"
      ? value.timezone
      : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [edited, setEdited] = useState(false);
  const schedule = useMemo(
    () => (edited ? draftToSchedule(draft, timezone) : value),
    [edited, draft, timezone, value],
  );
  const result = useSchedulePreview(schedule, preview);
  return (
    <fieldset disabled={disabled}>
      <div className="scheduled-task-fields">
        <ScheduledTaskScheduleFields
          schedule={draft}
          onChange={(next) => {
            setDraft(next);
            setEdited(true);
            onChange(draftToSchedule(next, timezone));
          }}
        />
      </div>
      <ScheduledTaskPreview
        schedule={draft}
        timezone={timezone}
        {...result}
        error={edited ? scheduleDraftError(draft) : undefined}
      />
    </fieldset>
  );
};
