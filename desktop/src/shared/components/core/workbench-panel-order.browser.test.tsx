import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { measureWorkbenchPanelOrder } from "./workbench-panel-order.fixture";

it.each([false, true])("扩展中心返回任务后保持中栏与右栏位置（desktop=%s）", async (desktop) => {
  for (const width of [1440, 1000, 600]) {
    await page.viewport(width, 900);
    for (const sidebarOpen of [true, false]) {
      const { before, restored } = measureWorkbenchPanelOrder(desktop, sidebarOpen);
      for (const layout of restored) {
        expect(layout.center).toEqual(before.center);
        expect(layout.inspector).toEqual(before.inspector);
        expect(layout.inner).toEqual(layout.center);
        expect(layout.center.width).toBeGreaterThan(0);
        expect(layout.inspector.x).toBe(width > 1100 ? layout.center.x + layout.center.width : before.inspector.x);
        expect(layout.center.width).toBe(width <= 760 ? layout.shell.width : before.center.width);
      }
    }
  }
});
