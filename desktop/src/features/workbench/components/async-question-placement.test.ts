import { expect, test } from "vitest";
import source from "./workbench-shell-active-task.tsx?raw";

test("mounts questions between the timeline and composer", () => {
  expect(source.indexOf("<AsyncQuestionDock ")).toBeGreaterThan(source.indexOf("<TaskTimeline"));
  expect(source.indexOf("<AsyncQuestionDock ")).toBeLessThan(source.indexOf("<WorkbenchComposer\n"));
});
