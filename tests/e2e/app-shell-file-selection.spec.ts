import { expect, test } from "./fixtures/app-shell.js";

test("浅色文件编辑器显示行内选区并复制所选字符 @cross-browser", async ({ page, browserName }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.route("**/v1/projects/codexly/files/text**", async (route) => {
    await route.fulfill({
      json: {
        path: "docs/architecture-design.md",
        content: "alpha bravo charlie\n",
        version: "b".repeat(64),
        revision: "a".repeat(64),
      },
    });
  });

  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("button", { name: /architecture-design\.md\s+\(line 100\)/u }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const line = page.locator("[data-document-workspace] .cm-line").first();
  await expect(line).toHaveText("alpha bravo charlie");
  const { start, end, sample } = await line.evaluate((element) => {
    const text = element.firstChild;
    if (!text) throw new Error("编辑器中没有正文");
    const range = document.createRange();
    const character = (index: number) => {
      range.setStart(text, index);
      range.setEnd(text, index + 1);
      return range.getBoundingClientRect();
    };
    const first = character(2);
    const last = character(8);
    const space = character(5);
    return {
      start: { x: first.left + 1, y: first.top + first.height / 2 },
      end: { x: last.left + 1, y: last.top + last.height / 2 },
      sample: {
        x: Math.floor(space.left + space.width / 2),
        y: Math.floor(space.top + space.height / 2),
        width: 1,
        height: 1,
      },
    };
  });
  await page.mouse.click(end.x, end.y);
  await expect(line).toHaveClass(/cm-activeLine/u);
  // 取当前行的空格像素，确认选区实际画在屏幕上，避免只断言 DOM 选区。
  const before = await page.screenshot({ clip: sample, scale: "css" });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => document.getSelection()?.toString())).toBe("pha br");
  await expect(line).toHaveClass(/cm-activeLine/u);
  await expect(page.locator(".cm-selectionBackground")).toBeVisible();
  const after = await page.screenshot({ clip: sample, scale: "css" });
  expect(after.equals(before), "当前行的背景不能遮住局部选区").toBe(false);

  if (browserName === "chromium") {
    await page.keyboard.press("ControlOrMeta+C");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("pha br");
  }
});
