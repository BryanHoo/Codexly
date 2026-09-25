import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { webkit } from "@playwright/test";
import ts from "typescript";

const root = new URL("../", import.meta.url);

void test("Legacy 任务消息产物在禁用后行断言时仍可加载", async (t) => {
  const assets = new URL("dist-legacy/assets/", root);
  const files = await readdir(assets);
  const message = files.find((name) => /^message-response-.*\.js$/.test(name));
  assert.ok(message);
  // 字面量在解析阶段报错，不能用替换 RegExp 构造器模拟，需独立扫描全部 JS 产物。
  for (const name of files.filter((file) => file.endsWith(".js"))) {
    const source = await readFile(new URL(name, assets), "utf8");
    const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const visit = (node) => {
      if (ts.isRegularExpressionLiteral(node)) assert.doesNotMatch(node.text, /\(\?<[=!]/, name);
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  const browser = await webkit.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://legacy.test/**", async (route) => {
    const name = new URL(route.request().url()).pathname.replace(/^\/(?:assets\/)?/, "");
    if (files.includes(name)) {
      await route.fulfill({ contentType: "text/javascript", body: await readFile(new URL(name, assets)) });
    } else {
      await route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div><div id="sample"></div></body></html>' });
    }
  });
  await page.goto("https://legacy.test/");
  const runtime = files.find((name) => /^react-runtime-.*\.js$/.test(name));
  assert.ok(runtime);
  await page.evaluate(async ({ name, runtime }) => {
    const NativeRegExp = globalThis.RegExp;
    globalThis.RegExp = new Proxy(NativeRegExp, {
      apply(target, thisArg, args) {
        if (/\(\?<[=!]/.test(String(args[0]))) {
          throw new SyntaxError(`Invalid regular expression: invalid group specifier name: ${String(args[0])}`);
        }
        return Reflect.apply(target, thisArg, args);
      },
      construct(target, args) {
        if (/\(\?<[=!]/.test(String(args[0]))) {
          throw new SyntaxError(`Invalid regular expression: invalid group specifier name: ${String(args[0])}`);
        }
        return Reflect.construct(target, args);
      },
    });
    const { MessageResponse } = await import(`/${name}`);
    const modules = Object.values(await import(`/${runtime}`)).map((factory) => factory());
    const react = modules.find((module) => module.createElement);
    const dom = modules.find((module) => module.createRoot);
    dom.createRoot(document.querySelector("#sample")).render(
      react.createElement(MessageResponse, { mode: "static" }, "联系 user@example.com，查看 [文件](src/main.ts:4)，a~b~c"),
    );
  }, { name: message, runtime });
  try {
    await page.locator('#sample a[href="mailto:user@example.com"]').waitFor({ timeout: 5000 });
  } catch (error) {
    assert.fail(`${error.message}\n${errors.join("\n")}`);
  }
});

void test("Modern output should exclude Legacy renderers and polyfills", async () => {
  const files = await readdir(new URL("dist/assets/", root));
  assert.ok(!files.some((name) => name.startsWith("polyfills-")));
  const manifest = JSON.parse(await readFile(new URL("dist/.vite/manifest.json", root), "utf8"));
  assert.ok(Object.keys(manifest).every((key) => !key.includes("compat/macos-legacy")));
  const sourcePanel = files.find((name) => /^project-source-panel-.*\.js$/.test(name));
  assert.ok(sourcePanel);
  const source = await readFile(new URL(`dist/assets/${sourcePanel}`, root), "utf8");
  assert.doesNotMatch(source, /legacy-code-token|VITE_MACOS_LEGACY/);
});

void test("Legacy output should restore missing APIs and switch compiled theme colors", async (t) => {
  const files = await readdir(new URL("dist-legacy/assets/", root));
  const polyfills = files.find((name) => /^polyfills-.*\.js$/.test(name));
  assert.ok(polyfills);
  const css = (await Promise.all(files.filter((name) => name.endsWith(".css"))
    .map((name) => readFile(new URL(`dist-legacy/assets/${name}`, root), "utf8")))).join("\n");
  const browser = await webkit.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  // 使用当前 WebKit 检查编译产物；删去待补齐的 API，验证 polyfill 的实际加载顺序。
  // 这不能模拟旧系统的 WebKit 实现，Monterey 真机仍需单独验收。
  await page.addInitScript(() => {
    delete Array.prototype.toSorted;
    delete Array.prototype.toReversed;
  });
  await page.route("https://legacy.test/**", async (route) => {
    if (route.request().url().endsWith("/polyfills.js")) {
      await route.fulfill({ contentType: "text/javascript", body: await readFile(new URL(`dist-legacy/assets/${polyfills}`, root)) });
    } else {
      await route.fulfill({ contentType: "text/html", body: `<html data-theme="light"><head><style>${css}</style><script type="module" src="/polyfills.js"></script></head><body><div class="bg-panel text-foreground" id="sample">CodeAgent</div><span class="legacy-code-token" style="color: red; --shiki-dark: #00ff00">token</span></body></html>` });
    }
  });
  await page.goto("https://legacy.test/");
  assert.deepEqual(await page.evaluate(() => [3, 1, 2].toSorted((a, b) => a - b)), [1, 2, 3]);
  assert.deepEqual(await page.evaluate(() => [1, 2].toReversed()), [2, 1]);
  const colors = () => page.locator("#sample").evaluate((node) => {
    const style = getComputedStyle(node);
    return [style.color, style.backgroundColor];
  });
  assert.deepEqual(await colors(), ["rgb(17, 17, 17)", "rgb(255, 255, 255)"]);
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  assert.deepEqual(await colors(), ["rgb(255, 255, 255)", "rgb(24, 24, 24)"]);
  assert.equal(await page.locator(".legacy-code-token").evaluate((node) => getComputedStyle(node).color), "rgb(0, 255, 0)");
});
