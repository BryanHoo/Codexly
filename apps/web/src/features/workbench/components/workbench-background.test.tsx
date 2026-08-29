import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  createBingWallpaperUrl,
  getBackgroundToneFromPixels,
  getWorkbenchBackgroundBlurRadius,
  getMillisecondsUntilNextLocalDay,
  WorkbenchBackgroundFrame,
} from "./workbench-background.js";

describe("WorkbenchBackground", () => {
  it("creates a stable same-origin URL and refresh delay for the local day", () => {
    const now = new Date(2026, 7, 25, 23, 59, 59, 500);

    expect(createBingWallpaperUrl(now)).toBe("/v1/workbench-background/bing?day=2026-08-25");
    expect(getMillisecondsUntilNextLocalDay(now)).toBe(1_500);
    expect(getWorkbenchBackgroundBlurRadius(0)).toBe(0);
    expect(getWorkbenchBackgroundBlurRadius(57)).toBe(12);
  });

  it("selects a readable foreground tone from the median image luminance", () => {
    const mostlyLightPixels = new Uint8ClampedArray([
      255, 255, 255, 255, 240, 240, 240, 255, 0, 0, 0, 255,
    ]);
    const mostlyDarkPixels = new Uint8ClampedArray([
      0, 0, 0, 255, 24, 24, 24, 255, 255, 255, 255, 255,
    ]);

    expect(getBackgroundToneFromPixels(mostlyLightPixels)).toBe("light");
    expect(getBackgroundToneFromPixels(mostlyDarkPixels)).toBe("dark");
    expect(getBackgroundToneFromPixels(new Uint8ClampedArray([255, 255, 255, 0]))).toBeNull();
  });

  it("renders the preprocessed canvas and full-workbench overlay only after drawing finishes", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchBackgroundFrame
        backgroundTone="dark"
        imageLoaded
        canvasRef={{ current: null }}
        preference={{
          blurPercentage: 57,
          mode: "bing",
          overlayOpacity: 40,
          selectedCustomImageId: null,
        }}
      >
        <div>Workbench</div>
      </WorkbenchBackgroundFrame>,
    );

    expect(markup).toContain('data-background-mode="bing"');
    expect(markup).toContain('data-background-tone="dark"');
    expect(markup).toContain('data-has-image="true"');
    expect(markup).toContain('data-workbench-background-canvas="true"');
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("filter:");
    expect(markup).toContain('data-workbench-background-overlay="true"');
    expect(markup).toContain("opacity:0.4");
    expect(markup).toContain("Workbench");
  });
});
