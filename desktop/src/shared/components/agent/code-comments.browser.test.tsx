import { expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { CodeComments as DesktopComments } from "./code-comments.js";
import { CodeComments as WebComments } from "../../../../../apps/web/src/shared/components/agent/code-comments.js";

for (const [platform, Comments] of [
  ["desktop", DesktopComments],
  ["web", WebComments],
] as const) {
  it(`${platform}: review details require explicit interaction after focus`, async () => {
    const screen = await render(
      <Comments
        comments={[
          {
            body: "Review details",
            end: 1,
            file: "src/app.ts",
            priority: 1,
            start: 1,
            title: "Review issue",
          },
        ]}
      />,
    );
    const trigger = screen.getByRole("button", { name: /Review issue/ }).element() as HTMLElement;
    trigger.focus();
    await expect.poll(() => document.activeElement === trigger).toBe(true);
    await expect.element(screen.getByRole("tooltip")).not.toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    await expect.element(screen.getByRole("tooltip")).toBeVisible();
  });
}
