import { LoadingSkeleton } from "@codexly/ui/core/loading-skeleton";
import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import "../../styles/globals.css";

afterEach(async () => {
  document.documentElement.style.removeProperty("color-scheme");
  await page.viewport(1440, 900);
});

for (const width of [320, 1440]) {
  for (const theme of ["light", "dark"]) {
    it(`${width}px / ${theme}: 所有布局可见、无横向溢出且不抢占键盘焦点`, async () => {
      await page.viewport(width, 900);
      document.documentElement.style.colorScheme = theme;
      const screen = await render(
        <div style={{ width: "100%" }}>
          <button type="button">保持焦点</button>
          {(["list", "conversation", "settings", "cards", "statistics", "workspace", "code"] as const).map((variant) => (
            <div key={variant} style={{ height: variant === "workspace" ? 600 : undefined }}>
              <LoadingSkeleton variant={variant} label={`正在加载 ${variant}`} />
            </div>
          ))}
        </div>,
      );
      const trigger = screen.getByRole("button", { name: "保持焦点" });
      (trigger.element() as HTMLElement).focus();
      await expect.element(trigger).toHaveFocus();
      const regions = document.querySelectorAll<HTMLElement>('[data-slot="loading-skeleton"]');
      expect(regions).toHaveLength(7);
      for (const region of regions) {
        expect(region.getBoundingClientRect().width).toBeGreaterThan(0);
        expect(region.scrollWidth).toBeLessThanOrEqual(region.clientWidth);
        expect(region.querySelectorAll("button, input, a, [tabindex]")).toHaveLength(0);
        // 窄屏工作台会隐藏桌面侧栏，检查当前实际显示的占位图形。
        const shape = [...region.querySelectorAll<HTMLElement>('[data-slot="skeleton"]')]
          .find((element) => element.getBoundingClientRect().height > 0)!;
        expect(shape).toBeDefined();
        expect(shape.getBoundingClientRect().height).toBeGreaterThan(0);
        const css = getComputedStyle(shape);
        expect(css.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
        expect(css.animationName).toBe(matchMedia("(prefers-reduced-motion: reduce)").matches ? "none" : "pulse");
      }
    });
  }
}
