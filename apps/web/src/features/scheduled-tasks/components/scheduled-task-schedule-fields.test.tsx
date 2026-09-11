import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import { defaultScheduleDraft, type SchedulePreset } from "../scheduled-task-schedule.js";
import { ScheduledTaskScheduleFields } from "./scheduled-task-schedule-fields.js";

function renderFields(preset: SchedulePreset): string {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ScheduledTaskScheduleFields
        onChange={() => undefined}
        schedule={{ ...defaultScheduleDraft(), preset }}
      />
    </I18nextProvider>,
  );
}

describe("ScheduledTaskScheduleFields", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("zh-CN");
  });

  it.each(["daily", "weekdays", "weekends"] as const)(
    "shows only time for %s recurrence",
    (preset) => {
      const markup = renderFields(preset);

      expect(markup).toContain('type="time"');
      expect(markup).not.toContain("触发时间");
      expect(markup).not.toContain("周几");
      expect(markup).not.toContain("每月几号");
    },
  );

  it("shows weekday and time for weekly recurrence", () => {
    const markup = renderFields("weekly");

    expect(markup).toContain('type="time"');
    expect(markup).toContain('aria-label="重复日期"');
    expect(markup).toContain("aria-pressed=");
    expect(markup).not.toContain("每月几号");
  });

  it("shows month day and time for monthly recurrence", () => {
    const markup = renderFields("monthly");

    expect(markup).toContain('type="time"');
    expect(markup).toContain("每月几号");
    expect(markup).toContain(">31</button>");
    expect(markup).toContain("最后一天");
    expect(markup).not.toContain("周几");
  });

  it("shows a date and time for once", () => {
    const markup = renderFields("once");

    expect(markup).toContain("触发时间");
    expect(markup).not.toContain('type="time"');
  });

  it("shows visual intervals and end conditions without a raw RRULE input", () => {
    const markup = renderFields("custom");
    expect(markup).toContain('aria-label="重复间隔"');
    expect(markup).toContain('value="YEARLY"');
    expect(markup).toContain("开始日期");
    expect(markup).toContain("安排指定次数后");
    expect(markup).not.toContain("RRULE");
  });
});
