import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { WorkbenchBackgroundSettings } from "./workbench-background-settings.js";

describe("WorkbenchBackgroundSettings", () => {
  it("renders uploaded images as selectable square thumbnails with delete actions", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <WorkbenchBackgroundSettings
          customImages={[
            {
              blob: new Blob(["first"], { type: "image/png" }),
              createdAt: 1,
              id: "first",
              name: "first.png",
            },
            {
              blob: new Blob(["second"], { type: "image/jpeg" }),
              createdAt: 2,
              id: "second",
              name: "second.jpg",
            },
          ]}
          disabled={false}
          onCustomFilesAdd={vi.fn()}
          onCustomImageRemove={vi.fn()}
          onCustomImageSelect={vi.fn()}
          onPreferenceChange={vi.fn()}
          preference={{
            blurPercentage: 0,
            mode: "custom",
            overlayOpacity: 60,
            selectedCustomImageId: "second",
          }}
        />
      </TooltipProvider>,
    );

    expect(markup).toContain('aria-label="自定义背景图片"');
    expect(markup).toContain('aria-label="使用 first.png 作为工作台背景"');
    expect(markup).toContain('aria-label="删除 first.png"');
    expect(markup).toMatch(/aria-label="使用 second\.jpg 作为工作台背景" aria-pressed="true"/u);
    expect(markup.match(/aspect-square/gu)).toHaveLength(3);
    expect(markup).toContain("multiple");
  });
});
