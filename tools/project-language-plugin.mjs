import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const requireUi = createRequire(new URL("../packages/ui/package.json", import.meta.url));

async function loadLanguageSupport() {
  const source = await readFile(
    new URL("../packages/ui/src/agent/code-languages.ts", import.meta.url),
    "utf8",
  );
  const modules = [...source.matchAll(/import\("(shiki\/langs\/[^"]+)"\)/gu)];
  const registrations = (
    await Promise.all(
      modules.map(async ([, specifier]) => {
        const loaded = await import(pathToFileURL(requireUi.resolve(specifier)).href);
        return loaded.default;
      }),
    )
  ).flat();
  return {
    names: new Set(
      registrations.flatMap((language) => [language.name, ...(language.aliases ?? [])]),
    ),
    scopes: new Set(registrations.map((language) => language.scopeName)),
  };
}

export function pruneLanguageGrammar(grammar, { names, scopes }) {
  const removed = new Set();
  for (const [key, rule] of Object.entries(grammar.repository ?? {})) {
    if (!/^(?:fenced_code_block_|commonmark-code-fenced-)/u.test(key)) continue;
    const includes = [
      ...JSON.stringify(rule).matchAll(/"include":"((?:source|text)\.[^"]+)"/gu),
    ].map(([, scope]) => scope);
    if (includes.length > 0 && !includes.some((scope) => scopes.has(scope))) removed.add(key);
  }
  // 同步删除仓储规则及其引用，未注册的代码围栏交给通用纯文本规则处理。
  function prune(value) {
    if (Array.isArray(value))
      return value.filter((entry) => !removed.has(entry?.include?.slice(1))).map(prune);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !removed.has(key))
        .map(([key, entry]) => [
          key,
          key === "embeddedLangs" || key === "embeddedLangsLazy"
            ? entry.filter((name) => names.has(name))
            : prune(entry),
        ]),
    );
  }
  return prune(grammar);
}

export function restrictLanguageModule(code, mode, support) {
  const source = ts.createSourceFile(
    "language.js",
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const edits = [];
  function visit(node) {
    if (
      mode === "grammar" &&
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "JSON.parse" &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const argument = node.arguments[0];
      const grammar = pruneLanguageGrammar(JSON.parse(argument.text), support);
      edits.push([
        argument.getStart(source),
        argument.end,
        JSON.stringify(JSON.stringify(grammar)),
      ]);
      return;
    }
    if (
      mode !== "grammar" &&
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      const entries = node.initializer.properties
        .filter(ts.isPropertyAssignment)
        .filter((property) => ts.isStringLiteral(property.initializer))
        .map((property) => [property.name.text, property.initializer.text]);
      const isLanguageMap =
        mode === "extension"
          ? node.name.getText(source) === "EXTENSION_TO_FILE_FORMAT"
          : entries.length > 50 &&
            entries.some(([key]) => key === "javascript") &&
            entries.some(([key]) => key === "typescript");
      if (isLanguageMap) {
        const selected = entries.filter(([key, value]) =>
          support.names.has(mode === "extension" ? value : key),
        );
        edits.push([
          node.initializer.getStart(source),
          node.initializer.end,
          JSON.stringify(Object.fromEntries(selected)),
        ]);
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return edits
    .sort(([left], [right]) => right - left)
    .reduce(
      (result, [start, end, replacement]) =>
        result.slice(0, start) + replacement + result.slice(end),
      code,
    );
}

export function projectLanguagePlugin() {
  let support;
  return {
    name: "project-language-whitelist",
    enforce: "pre",
    async transform(code, id) {
      const path = id.replaceAll("\\", "/").split("?")[0];
      const mode = /\/@shikijs\/langs\/dist\/(?:markdown|mdx)\.mjs$/u.test(path)
        ? "grammar"
        : /\/@pierre\/diffs\/dist\/utils\/getFiletypeFromFileName\.js$/u.test(path)
          ? "extension"
          : /\/streamdown\/dist\/[^/]+\.js$/u.test(path)
            ? "language"
            : undefined;
      if (mode === undefined) return null;
      // 只在构建工具中解析依赖数据；语言元数据按构建共享一次，前端不增加过滤开销。
      support ??= loadLanguageSupport();
      return { code: restrictLanguageModule(code, mode, await support), map: null };
    },
  };
}
