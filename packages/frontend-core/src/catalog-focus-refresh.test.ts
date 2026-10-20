import { expect, it, vi } from "vitest";
import { installCatalogFocusRefresh, isCatalogListQuery } from "./catalog-focus-refresh.js";

it("coalesces visible focus events and releases both listeners", async () => {
  const windowTarget = new EventTarget();
  const documentTarget = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const refresh = vi.fn();
  const dispose = installCatalogFocusRefresh(refresh, windowTarget, documentTarget);
  windowTarget.dispatchEvent(new Event("focus"));
  documentTarget.dispatchEvent(new Event("visibilitychange"));
  await Promise.resolve();
  expect(refresh).toHaveBeenCalledOnce();
  documentTarget.visibilityState = "hidden";
  windowTarget.dispatchEvent(new Event("focus"));
  await Promise.resolve();
  expect(refresh).toHaveBeenCalledOnce();
  documentTarget.visibilityState = "visible";
  windowTarget.dispatchEvent(new Event("focus"));
  dispose();
  await Promise.resolve();
  expect(refresh).toHaveBeenCalledOnce();
});

it("selects catalog lists without selecting chat content or file queries", () => {
  for (const key of [
    ["projects"],
    ["projects", "p", "tasks"],
    ["projects", "p", "archived-tasks", "", null],
    ["task-board", "completed", null],
  ])
    expect(isCatalogListQuery(key)).toBe(true);
  for (const key of [
    ["projects", "p", "tasks", "t"],
    ["projects", "p", "tasks", "t", "queue"],
    ["projects", "p", "file-tree"],
    ["models"],
  ])
    expect(isCatalogListQuery(key)).toBe(false);
});
