import { useState } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { I18nextProvider, i18n } from "../../i18n/i18n.js";
import { defaultScheduleDraft, draftToSchedule } from "./scheduled-task-schedule.js";
import { ScheduledTaskScheduleFields } from "./scheduled-task-schedule-fields.js";
import "../../shared/styles/globals.css";
import "../../shared/styles/scheduled-tasks.css";

function Form() {
  const [schedule, setSchedule] = useState(() => defaultScheduleDraft(Date.UTC(2030, 0, 1)));
  return <div className="scheduled-task-fields" style={{ width: 460 }}>
    <ScheduledTaskScheduleFields schedule={schedule} onChange={setSchedule} />
    <output hidden>{draftToSchedule(schedule, "UTC", Date.UTC(2029, 0, 1))?.type === "rrule" ? JSON.stringify(draftToSchedule(schedule, "UTC", Date.UTC(2029, 0, 1))) : ""}</output>
  </div>;
}

describe("visual schedule fields", () => {
  it("offers weekends without requiring weekday selection", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(<I18nextProvider i18n={i18n}><Form /></I18nextProvider>);
    await expect.element(screen.getByRole("option", { name: "周末（周六、周日）", exact: true })).toBeInTheDocument();
    await screen.getByRole("combobox", { name: "重复规则" }).selectOptions("weekends");
    expect(screen.container.querySelector("output")!.textContent).toContain("BYDAY=SA,SU");
    await expect.element(screen.getByRole("button", { name: "周六", exact: true })).not.toBeInTheDocument();
  });
  it("keeps all choices within desktop bounds in both languages and themes", async () => {
    const screen = await render(<I18nextProvider i18n={i18n}><Form /></I18nextProvider>);
    try {
      for (const [language, theme, width] of [["zh-CN", "light", 1280], ["en", "dark", 1920]] as const) {
        await i18n.changeLanguage(language);
        document.documentElement.dataset.theme = theme;
        await page.viewport(width, 720);
        const repeat = screen.getByRole("combobox", { name: language === "en" ? "Repeat" : "重复规则", exact: true });
        await repeat.selectOptions("monthly");
        const form = screen.container.querySelector<HTMLElement>(".scheduled-task-fields")!;
        expect(form.scrollWidth).toBeLessThanOrEqual(form.clientWidth);
        for (const control of form.querySelectorAll("button, input, select")) {
          expect(control.getBoundingClientRect().right).toBeLessThanOrEqual(form.getBoundingClientRect().right);
        }
        await page.screenshot({ path: `../../../test-results/schedule-${language}-${theme}.png` });
      }
    } finally { document.documentElement.dataset.theme = "light"; await i18n.changeLanguage("zh-CN"); await page.viewport(1440, 900); }
  });
  it("builds a biweekly plan without exposing RRULE input", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(<I18nextProvider i18n={i18n}><Form /></I18nextProvider>);
    await screen.getByRole("combobox", { name: "重复规则" }).selectOptions("custom");
    await expect.element(screen.getByRole("textbox", { name: "RRULE", exact: true })).not.toBeInTheDocument();
    await screen.getByRole("spinbutton", { name: "重复间隔" }).fill("2");
    await screen.getByRole("combobox", { name: "间隔单位" }).selectOptions("WEEKLY");
    await screen.getByRole("button", { name: "周三", exact: true }).click();
    await screen.getByRole("combobox", { name: "结束" }).selectOptions("count");
    await screen.getByRole("spinbutton", { name: "计划次数" }).fill("6");
    expect(screen.container.querySelector("output")!.textContent).toContain("INTERVAL=2");
    expect(screen.container.querySelector("output")!.textContent).toContain("COUNT=6");
    await page.viewport(1280, 720);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1280);
  });
  it("supports month end and multiple ordinal weekdays", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(<I18nextProvider i18n={i18n}><Form /></I18nextProvider>);
    await screen.getByRole("combobox", { name: "重复规则" }).selectOptions("monthly");
    await screen.getByRole("button", { name: "最后一天", exact: true }).click();
    expect(screen.container.querySelector("output")!.textContent).toContain("BYMONTHDAY=1,-1");
    await screen.getByRole("combobox", { name: "每月重复方式" }).selectOptions("weekday");
    await screen.getByRole("button", { name: "第一个", exact: true }).click();
    await screen.getByRole("button", { name: "第二个", exact: true }).click();
    await screen.getByRole("button", { name: "第四个", exact: true }).click();
    await screen.getByRole("combobox", { name: "周几" }).selectOptions("WE");
    expect(screen.container.querySelector("output")!.textContent).toContain("BYDAY=2WE,4WE");
  });
});
