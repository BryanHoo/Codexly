import { expect, taskSnapshot, test } from "./fixtures/app-shell.js";

test("用户消息快捷导航保持显示并跳转到对应消息", async ({ page }) => {
  let turns = Array.from({ length: 12 }, (_, index) => ({
    completedAt: `2026-08-24T08:${String(index).padStart(2, "0")}:30.000Z`,
    error: null,
    id: `navigation-turn-${String(index + 1)}`,
    items: [
      {
        id: `navigation-user-${String(index + 1)}`,
        role: "user" as const,
        text: `第 ${String(index + 1)} 条用户导航消息`,
        type: "message" as const,
      },
      {
        id: `navigation-assistant-${String(index + 1)}`,
        role: "assistant" as const,
        text: `第 ${String(index + 1)} 条回复\n\n${"用于撑开虚拟时间线的内容。".repeat(30)}`,
        type: "message" as const,
      },
    ],
    startedAt: `2026-08-24T08:${String(index).padStart(2, "0")}:00.000Z`,
    status: "completed" as const,
  }));
  await page.route("**/v1/projects/codexly/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        checkpoint: { sequence: 0, sessionId: "navigation-session" },
        snapshot: { ...taskSnapshot, turns },
      },
    });
  });

  await page.goto("/p/codexly/t/task-1");
  const navigation = page.getByRole("navigation", { name: "用户消息快捷导航" });
  const navigationItems = navigation.locator("[data-timeline-navigation-item]");
  await expect(navigation).toBeVisible();
  await expect(navigation).toBeInViewport();
  await expect(navigationItems).toHaveCount(12);
  const firstNavigationMarker = navigationItems.first().locator("span[aria-hidden='true']");
  const main = page.locator("main");
  const conversation = page.getByRole("log");
  const readMarkerRightClearance = async () => {
    const [mainBox, markerBox, scrollMetrics] = await Promise.all([
      main.boundingBox(),
      firstNavigationMarker.boundingBox(),
      conversation.evaluate((element) => {
        const container = element as HTMLElement;
        return {
          scrollbarWidth: container.offsetWidth - container.clientWidth,
          scrollable: container.scrollHeight > container.clientHeight,
        };
      }),
    ]);
    return {
      gapBeyondScrollbar:
        (mainBox?.x ?? 0) +
        (mainBox?.width ?? 0) -
        ((markerBox?.x ?? 0) + (markerBox?.width ?? 0)) -
        scrollMetrics.scrollbarWidth,
      scrollable: scrollMetrics.scrollable,
    };
  };
  await expect.poll(readMarkerRightClearance).toEqual({
    gapBeyondScrollbar: 10,
    scrollable: true,
  });
  const readMarkerStyle = () =>
    firstNavigationMarker.evaluate((element) => {
      const style = getComputedStyle(element);
      const colorComponents = style.backgroundColor.match(/[\d.]+/gu)?.map(Number) ?? [];
      const backgroundAlpha = colorComponents.length === 4 ? (colorComponents[3] ?? 1) : 1;
      return {
        borderRadius: style.borderRadius,
        effectiveAlpha: backgroundAlpha * Number(style.opacity),
        height: element.getBoundingClientRect().height,
        width: element.getBoundingClientRect().width,
      };
    });
  const markerStyle = await readMarkerStyle();
  expect(markerStyle.width).toBe(8);
  expect(markerStyle.height).toBe(2);
  expect(markerStyle.borderRadius).toBe("9999px");
  expect(markerStyle.effectiveAlpha).toBeGreaterThanOrEqual(0.2);
  expect(markerStyle.effectiveAlpha).toBeLessThanOrEqual(0.28);
  const markerCenters = await navigationItems.evaluateAll((buttons) =>
    buttons.slice(0, 2).map((button) => {
      const box = button
        .querySelector<HTMLElement>(".task-timeline-navigation-marker")
        ?.getBoundingClientRect();
      return (box?.y ?? 0) + (box?.height ?? 0) / 2;
    }),
  );
  expect((markerCenters[1] ?? 0) - (markerCenters[0] ?? 0)).toBe(8);
  await expect(
    navigation.locator('[data-timeline-navigation-item][aria-current="location"]'),
  ).toHaveCount(1);
  expect(
    await navigationItems.first().evaluate((button) => {
      const marker = button.querySelector<HTMLElement>(".task-timeline-navigation-marker");
      if (marker === null) return false;
      const box = marker.getBoundingClientRect();
      const hitTarget = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return hitTarget !== null && button.contains(hitTarget);
    }),
  ).toBe(true);

  await navigationItems.first().hover();
  await expect
    .poll(async () => {
      const hoveredMarkerStyle = await readMarkerStyle();
      return {
        alphaIncreased: hoveredMarkerStyle.effectiveAlpha > markerStyle.effectiveAlpha,
        heightIncreased: hoveredMarkerStyle.height > markerStyle.height,
        widthIncreased: hoveredMarkerStyle.width > markerStyle.width,
      };
    })
    .toEqual({
      alphaIncreased: true,
      heightIncreased: true,
      widthIncreased: true,
    });

  await navigationItems.nth(4).hover();
  await expect(
    page.getByRole("tooltip").getByText("第 5 条用户导航消息", { exact: true }),
  ).toBeVisible();
  await navigationItems.first().click();
  await page.mouse.move(0, 0);
  const firstMessage = page.locator("[data-conversation-anchor]").filter({
    hasText: "第 1 条用户导航消息",
  });
  await expect(firstMessage).toBeInViewport();
  await expect(navigationItems.first()).toHaveAttribute("aria-current", "location");
  const currentMarkerStyle = await readMarkerStyle();
  expect(currentMarkerStyle.effectiveAlpha).toBeGreaterThan(markerStyle.effectiveAlpha);

  await page.getByRole("button", { name: "收起项目侧栏" }).click();
  await expect(navigation).toBeVisible();
  await expect(navigation).toBeInViewport();
  await expect.poll(readMarkerRightClearance).toEqual({
    gapBeyondScrollbar: 10,
    scrollable: true,
  });
  await page.setViewportSize({ height: 720, width: 320 });
  await expect(navigation).toBeHidden();

  turns = turns.slice(0, 1);
  await page.reload();
  await expect(page.getByRole("navigation", { name: "用户消息快捷导航" })).toHaveCount(0);
});
