import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProjectRootSelector } from "./project-root-selector.js";

describe("ProjectRootSelector", () => {
  it("stays hidden for a single root", () => {
    expect(
      renderToStaticMarkup(
        <ProjectRootSelector
          onChange={vi.fn()}
          roots={[{ id: "root-primary", path: "/workspace/primary" }]}
          value="root-primary"
        />,
      ),
    ).toBe("");
  });

  it("renders an accessible selector for an aggregate project", () => {
    const markup = renderToStaticMarkup(
      <ProjectRootSelector
        onChange={vi.fn()}
        roots={[
          { id: "root-primary", path: "/workspace/primary" },
          { id: "root-secondary", path: "/workspace/secondary" },
        ]}
        value="root-primary"
      />,
    );

    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('aria-label="选择项目目录"');
    expect(markup).toContain("h-6");
    expect(markup).toContain("/workspace/primary");
  });
});
