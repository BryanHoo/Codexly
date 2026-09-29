import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { EmptyTimeline } from "./task-timeline-status.js";

const projects = [
  { createdAt: "2026-07-22T06:00:00.000Z", id: "codexly", name: "Codexly", roots: [] },
];

describe("empty task timeline", () => {
  it("offers project switching from the temporary chat", async () => {
    const onProjectChange = vi.fn();
    const screen = await render(
      <EmptyTimeline
        onProjectChange={onProjectChange}
        projectId="temporary"
        projects={projects}
        scopeName="聊天"
      />,
    );

    const selector = screen.getByRole("combobox", {
      name: /选择新聊天项目|Select a project for the new chat/u,
    });
    await expect.element(selector).toHaveValue("temporary");
    await selector.selectOptions("codexly");
    expect(onProjectChange).toHaveBeenCalledWith("codexly");
  });

  it("offers the temporary chat from a project draft", async () => {
    const onProjectChange = vi.fn();
    const screen = await render(
      <EmptyTimeline onProjectChange={onProjectChange} projectId="codexly" projects={projects} />,
    );

    const selector = screen.getByRole("combobox", {
      name: /选择新聊天项目|Select a project for the new chat/u,
    });
    await selector.selectOptions("temporary");
    expect(onProjectChange).toHaveBeenCalledWith("temporary");
  });
});
