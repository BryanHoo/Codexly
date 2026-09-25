import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { chromium, webkit } from "@playwright/test";

let server;
before(async () => {
  server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4187", "--strictPort"], { stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Preview server timed out")), 15000);
    server.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("4187")) { clearTimeout(timeout); resolve(); }
    });
    server.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Preview exited: ${code}`)); });
  });
});
after(() => server?.kill());

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  void test(`${name}: production task window loads its own styles and compact chrome`, async () => {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 440, height: 220 } });
      await page.addInitScript(() => {
        window.__TAURI_INTERNALS__ = {
          transformCallback: () => 1,
          invoke: async (command, args) => {
            if (command === "connect_task_window") args.onUpdate.onmessage({
              sequence: 1, title: "阅读并理解项目", status: "running", truncated: false,
              order: ["a", "b", "c", "d"], updates: [
                { id: "a", kind: "message", text: "### 核对项目实现\n\n已完成 **SQLite 持久化** 与前端数据层检查，正在验证 `pnpm check`。", append: false },
                { id: "b", kind: "command", text: "pnpm check · 类型检查与回归测试", append: false },
                { id: "c", kind: "file_change", text: "src/features/task-window/task-window.tsx", append: false },
                { id: "d", kind: "message", text: "正在整理最后的验证结果…", append: false },
              ],
            });
            return null;
          },
        };
      });
      await page.goto("http://127.0.0.1:4187/?window=task-window&theme=dark");
      await page.locator(".task-window-header").waitFor();
      const actual = await page.evaluate(() => ({
        display: getComputedStyle(document.querySelector(".task-window-header")).display,
        font: getComputedStyle(document.querySelector(".task-window")).fontSize,
        styles: [...document.styleSheets].map((sheet) => sheet.href),
      }));
      assert.equal(actual.display, "flex");
      assert.equal(actual.font, "12px");
      assert.ok(actual.styles.some((href) => href?.includes("task-window")));
      await page.getByText("正在整理最后的验证结果…", { exact: true }).waitFor();
      assert.equal(await page.locator(".task-window-operation").count(), 2);
      for (const theme of ["dark", "light"]) {
        await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
        const style = await page.evaluate(() => {
          const root = document.querySelector(".task-window");
          const probe = document.createElement("span");
          probe.style.background = "var(--ui-color-content)";
          probe.style.color = "var(--ui-color-text)";
          root.append(probe);
          const expected = getComputedStyle(probe);
          const result = {
            background: getComputedStyle(root).backgroundColor,
            expectedBackground: expected.backgroundColor,
            color: getComputedStyle(root).color,
            expectedColor: expected.color,
            border: getComputedStyle(root).borderTopWidth,
            headerBorder: getComputedStyle(document.querySelector(".task-window-header")).borderBottomWidth,
            roots: [document.documentElement, document.body, document.querySelector("#root")].map((element) => getComputedStyle(element).backgroundColor),
            operationBorder: getComputedStyle(document.querySelector(".task-window-operation")).borderTopWidth,
          };
          probe.remove();
          return result;
        });
        assert.equal(style.border, "0px");
        assert.equal(style.headerBorder, "0px");
        assert.equal(style.background, style.expectedBackground);
        assert.equal(style.color, style.expectedColor);
        assert.ok(style.roots.every((color) => color === "rgba(0, 0, 0, 0)"));
        assert.equal(style.operationBorder, "1px");
        await page.screenshot({ path: `/tmp/codeagent-task-window-${name}-${theme}.png`, omitBackground: true });
      }
    } finally { await browser.close(); }
  });
}
