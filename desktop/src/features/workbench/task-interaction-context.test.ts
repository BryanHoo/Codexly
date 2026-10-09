import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { TaskInteractionContext, useTaskInteractionBlocked } from "./task-interaction-context.js";
import { SplitTaskInteractionContext } from "./split-task-interaction.js";

function TaskAction({ projectId, taskId }: { projectId: string; taskId: string }) {
  return createElement(
    "button",
    { disabled: useTaskInteractionBlocked(projectId, taskId) },
    "Action",
  );
}

it("keeps split task ownership restrictions across the outer shell context", () => {
  const render = (projectId: string, taskId: string) =>
    renderToStaticMarkup(
      createElement(
        SplitTaskInteractionContext,
        { value: new Set([JSON.stringify(["project", "locked"])]) },
        createElement(
          TaskInteractionContext,
          { value: null },
          createElement(TaskAction, { projectId, taskId }),
        ),
      ),
    );
  expect(render("project", "locked")).toContain("disabled");
  expect(render("project", "writable")).not.toContain("disabled");
  expect(render("other", "locked")).not.toContain("disabled");
});
