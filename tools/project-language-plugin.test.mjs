import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  projectLanguagePlugin,
  pruneLanguageGrammar,
  restrictLanguageModule,
} from "./project-language-plugin.mjs";

const support = {
  names: new Set(["javascript", "js", "typescript", "ts"]),
  scopes: new Set(["source.js"]),
};

test("keeps supported code fences and removes unregistered embedded grammars and references", () => {
  const grammar = {
    embeddedLangsLazy: ["js", "unlisted"],
    patterns: [{ include: "#fenced_code_block_js" }, { include: "#fenced_code_block_unlisted" }],
    repository: {
      fenced_code_block_js: { patterns: [{ include: "source.js" }] },
      fenced_code_block_unlisted: { patterns: [{ include: "source.unlisted" }] },
      heading: { match: "^#", name: "markup.heading" },
    },
  };
  const result = pruneLanguageGrammar(grammar, support);
  assert.deepEqual(result.embeddedLangsLazy, ["js"]);
  assert.deepEqual(result.patterns, [{ include: "#fenced_code_block_js" }]);
  assert.deepEqual(result.repository, {
    fenced_code_block_js: grammar.repository.fenced_code_block_js,
    heading: grammar.repository.heading,
  });
  // 保留输入对象，避免修改语言模块在 Node 构建缓存中的共享注册数据。
  assert.deepEqual(grammar.embeddedLangsLazy, ["js", "unlisted"]);
});

test("restricts extension aliases while preserving surrounding executable code", () => {
  const input =
    'const EXTENSION_TO_FILE_FORMAT = {js:"javascript",ts:"typescript",other:"unlisted"}; export function lookup(value) { return EXTENSION_TO_FILE_FORMAT[value]; }';
  const result = restrictLanguageModule(input, "extension", support);
  assert.match(result, /"js":"javascript","ts":"typescript"/u);
  assert.doesNotMatch(result, /unlisted/u);
  assert.match(result, /export function lookup/u);
});

test("restricts the language download map and preserves unrelated string tables", () => {
  const entries = Object.fromEntries(
    Array.from({ length: 60 }, (_, index) => [`lang${index}`, `ext${index}`]),
  );
  const input = `var languages=${JSON.stringify({ ...entries, javascript: "js", typescript: "ts" })}; const labels={other:"unlisted"};`;
  const result = restrictLanguageModule(input, "language", support);
  assert.match(result, /var languages=\{"javascript":"js","typescript":"ts"\}/u);
  assert.match(result, /const labels=\{other:"unlisted"\}/u);
});

test("re-encodes bundled grammar JSON without damaging regular expressions", () => {
  const grammar = {
    repository: { heading: { match: "^\\s+\\w+$" } },
    embeddedLangsLazy: ["unlisted"],
  };
  const input = `const lang=Object.freeze(JSON.parse(${JSON.stringify(JSON.stringify(grammar))})); export default [lang];`;
  const result = restrictLanguageModule(input, "grammar", support);
  const encoded = result.match(/JSON.parse\(("(?:[^"\\]|\\.)*")\)/u)[1];
  assert.deepEqual(JSON.parse(JSON.parse(encoded)), {
    repository: grammar.repository,
    embeddedLangsLazy: [],
  });
});

test("the trimmed Markdown grammar still highlights supported fenced code", async () => {
  const requireUi = createRequire(new URL("../packages/ui/package.json", import.meta.url));
  const requireShiki = createRequire(requireUi.resolve("shiki/package.json"));
  const grammarPath = requireShiki.resolve("@shikijs/langs/markdown");
  const plugin = projectLanguagePlugin();
  const transformed = await plugin.transform(await readFile(grammarPath, "utf8"), grammarPath);
  const grammar = await import(`data:text/javascript,${encodeURIComponent(transformed.code)}`);
  const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, javascript, theme] =
    await Promise.all([
      import(pathToFileURL(requireUi.resolve("shiki/core")).href),
      import(pathToFileURL(requireUi.resolve("shiki/engine/javascript")).href),
      import(pathToFileURL(requireUi.resolve("shiki/langs/javascript.mjs")).href),
      import(pathToFileURL(requireUi.resolve("shiki/themes/github-light.mjs")).href),
    ]);
  const highlighter = await createHighlighterCore({
    engine: createJavaScriptRegexEngine({ forgiving: true }),
    langs: [grammar.default, javascript.default],
    themes: [theme.default],
  });
  try {
    // 通过真实引擎验证裁剪后的内嵌规则，防止构建成功却丢失正文或代码高亮。
    const { tokens } = highlighter.codeToTokens("```js\nconst value = 42;\n```", {
      lang: "markdown",
      theme: "github-light",
    });
    assert.equal(tokens[1].map((token) => token.content).join(""), "const value = 42;");
    assert.ok(new Set(tokens[1].map((token) => token.color)).size > 1);
  } finally {
    highlighter.dispose();
  }
});
