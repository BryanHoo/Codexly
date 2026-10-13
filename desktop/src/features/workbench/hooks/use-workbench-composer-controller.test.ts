import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { useWorkbenchComposerController } from "./use-workbench-composer-controller.js";
import { useSubmissionStartedAt } from "../components/use-submission-started-at.js";

it("clears submission timing without waiting for an intermediate render", () => {
  const onSubmissionStateChange = vi.fn();
  const capture = vi.fn<(value: { controller: ReturnType<typeof useWorkbenchComposerController>; timer: ReturnType<typeof useSubmissionStartedAt> }) => void>();
  function Probe() {
    const timer = useSubmissionStartedAt();
    const controller = useWorkbenchComposerController("project:task", (submitting) => {
      onSubmissionStateChange(submitting);
      timer.handleSubmissionStateChange(submitting);
    });
    capture({ controller, timer });
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  const probe = capture.mock.calls[0]?.[0];
  if (probe === undefined) throw new Error("Controller was not rendered");
  // 请求在同一渲染批次中结束时，也必须同步释放本地提交计时。
  probe.timer.beginSubmission();
  probe.controller.setIsSubmitting(true);
  probe.controller.setIsSubmitting(false);
  expect(probe.timer.getStartedAt()).toBeUndefined();
  expect(onSubmissionStateChange.mock.calls).toEqual([[true], [false]]);
});
