import { useState } from "react";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { ScheduledTaskPreview, ScheduledTaskSchedule } from "@/protocol/index.js";
import { useSchedulePreview, type PreviewSchedule } from "./use-schedule-preview.js";

const schedule = { type: "rrule", rrule: "FREQ=DAILY", startAtUnixMs: 1_900_000_000_000, timezone: "UTC" } satisfies ScheduledTaskSchedule;

function Harness({ preview }: Readonly<{ preview: PreviewSchedule }>) {
  const [rule, setRule] = useState(schedule);
  const state = useSchedulePreview(rule, preview);
  return <>
    <button type="button" onClick={() => setRule({ ...schedule, rrule: "FREQ=WEEKLY" })}>weekly</button>
    <button type="button" onClick={() => setRule({ ...schedule, rrule: "FREQ=MONTHLY" })}>monthly</button>
    <button type="button" disabled={state.pending || state.failed}>save</button>
    <button type="button" onClick={state.retry}>retry</button>
    <output>{state.dates?.join(",")}</output>
  </>;
}

it("keeps a single request in flight and discards outdated results", async () => {
  let resolveFirst: (response: ScheduledTaskPreview) => void = () => undefined;
  const first = new Promise<ScheduledTaskPreview>((resolve) => { resolveFirst = resolve; });
  const preview = vi.fn<PreviewSchedule>().mockReturnValueOnce(first).mockResolvedValue({ dates: [222] });
  const screen = await render(<Harness preview={preview} />);
  await expect.poll(() => preview.mock.calls.length).toBe(1);
  await screen.getByRole("button", { name: "weekly" }).click();
  await screen.getByRole("button", { name: "monthly" }).click();
  await expect.element(screen.getByRole("button", { name: "save" })).toBeDisabled();
  // 等待一个防抖窗口后，旧请求未完成时仍不能并发发起第二次计算。
  await new Promise((resolve) => setTimeout(resolve, 250));
  expect(preview).toHaveBeenCalledTimes(1);
  resolveFirst({ dates: [111] });
  await expect.poll(() => screen.container.querySelector("output")!.textContent).toBe("222");
  expect(preview.mock.calls.map(([value]) => value.type === "rrule" ? value.rrule : "once")).toEqual(["FREQ=DAILY", "FREQ=MONTHLY"]);
  await expect.element(screen.getByRole("button", { name: "save" })).toBeEnabled();
});

it("allows retry after a failed preview and releases requests on unmount", async () => {
  const preview = vi.fn<PreviewSchedule>().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ dates: [333] });
  const screen = await render(<Harness preview={preview} />);
  await expect.poll(() => preview.mock.calls.length).toBe(1);
  await expect.element(screen.getByRole("button", { name: "save" })).toBeDisabled();
  await screen.getByRole("button", { name: "retry" }).click();
  await expect.poll(() => screen.container.querySelector("output")!.textContent).toBe("333");
  await screen.getByRole("button", { name: "weekly" }).click();
  await screen.unmount();
  await new Promise((resolve) => setTimeout(resolve, 250));
  expect(preview).toHaveBeenCalledTimes(2);
});
