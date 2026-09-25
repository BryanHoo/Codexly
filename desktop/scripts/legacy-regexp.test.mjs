import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import remend from "remend";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

void test("消息处理模块不能包含 Safari 15.5 无法解析的后行断言", async () => {
  const source = await readFile(new URL("../src/shared/components/agent/message-response-processing.ts", import.meta.url), "utf8");
  const file = ts.createSourceFile("processing.ts", source, ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (ts.isRegularExpressionLiteral(node)) assert.doesNotMatch(node.text, /\(\?<[=!]/);
    ts.forEachChild(node, visit);
  };
  visit(file);
});

void test("Legacy remend 在缺少后行断言的引擎中加载并保持 Markdown 行为", async () => {
  const source = await readFile(new URL(import.meta.resolve("remend")), "utf8");
  const { legacyRegexpPlugin } = await import("./legacy-regexp.mjs");
  const transformed = legacyRegexpPlugin().transform(source, "/node_modules/remend/dist/index.js");
  assert.ok(transformed);
  assert.equal(legacyRegexpPlugin().transform(source, "/src/other.js"), null);
  assert.throws(() => legacyRegexpPlugin().transform("changed upstream", "/node_modules/remend/dist/index.js"), /regular expression changed/);
  const NativeRegExp = globalThis.RegExp;
  // 模拟旧 WebKit 的构造器限制，确保模块求值阶段不会先于渲染抛错。
  globalThis.RegExp = new Proxy(NativeRegExp, {
    construct(target, args) {
      assert.doesNotMatch(String(args[0]), /\(\?<[=!]/);
      return Reflect.construct(target, args);
    },
  });
  let legacyRemend;
  try {
    legacyRemend = (await import(`data:text/javascript;base64,${Buffer.from(transformed.code).toString("base64")}`)).default;
  } finally {
    globalThis.RegExp = NativeRegExp;
  }
  for (const value of ["a~b~c", "中文~测试", "𝒜~𝒝~𝒞", "a~~b", "~start", "end~", "`a~b` c~d", "```\na~b\n```\nc~d", "**bold", "[file](src/a.ts)"]) {
    assert.equal(legacyRemend(value), remend(value), value);
  }
});

void test("Legacy 邮箱识别保留原有边界与标点", async () => {
  let entry = import.meta.resolve("streamdown");
  for (const dependency of ["remark-gfm", "mdast-util-gfm", "mdast-util-gfm-autolink-literal"]) {
    entry = pathToFileURL(createRequire(entry).resolve(dependency)).href;
  }
  const url = new URL("lib/index.js", entry);
  const source = await readFile(url, "utf8");
  const { legacyRegexpPlugin } = await import("./legacy-regexp.mjs");
  const result = legacyRegexpPlugin().transform(source, url.pathname);
  assert.ok(result);
  const code = result.code.replace(/^(import .* from )'([^']+)'/gm,
    (_match, prefix, dependency) => `${prefix}'${pathToFileURL(createRequire(url).resolve(dependency)).href}'`);
  const original = await import(url.href);
  const legacy = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  for (const value of ["a@example.com", "(a@example.com), b@example.org", "/a@example.com", "中foo.bar@example.com", "😀a@example.com", "text a@example.com."]) {
    const tree = { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value }] }] };
    const expected = structuredClone(tree);
    original.gfmAutolinkLiteralFromMarkdown().transforms[0](expected);
    legacy.gfmAutolinkLiteralFromMarkdown().transforms[0](tree);
    assert.deepEqual(tree, expected, value);
  }
});
