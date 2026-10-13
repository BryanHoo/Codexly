import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  isComposerControllerScopeCurrent,
  useWorkbenchComposerController,
} from "./use-workbench-composer-controller.js";
import { useSubmissionStartedAt } from "../components/use-submission-started-at.js";

describe("Workbench composer controller", () => {
  it("clears the local submission timer even when submitting starts and ends before a render", () => {
    const onSubmissionStateChange = vi.fn();
    const capture =
      vi.fn<
        (value: {
          controller: ReturnType<typeof useWorkbenchComposerController>;
          timer: ReturnType<typeof useSubmissionStartedAt>;
        }) => void
      >();
    function Probe() {
      const timer = useSubmissionStartedAt();
      const controller = useWorkbenchComposerController("project-1:task-1", (submitting) => {
        onSubmissionStateChange(submitting);
        timer.handleSubmissionStateChange(submitting);
      });
      capture({ controller, timer });
      return null;
    }
    renderToStaticMarkup(<Probe />);
    const probe = capture.mock.calls[0]?.[0];
    if (probe === undefined) throw new Error("Controller was not rendered");
    // 不提交中间渲染，模拟同一批次内结束的请求；本地计时仍必须立即清理。
    probe.timer.beginSubmission();
    probe.controller.setIsSubmitting(true);
    probe.controller.setIsSubmitting(false);
    expect(probe.timer.getStartedAt()).toBeUndefined();
    expect(onSubmissionStateChange.mock.calls).toEqual([[true], [false]]);
  });
  it("accepts async results only for the active route scope", () => {
    expect(isComposerControllerScopeCurrent("project-1:task-1", "project-1:task-1")).toBe(true);
    expect(isComposerControllerScopeCurrent("project-1:task-2", "project-1:task-1")).toBe(false);
  });
});
