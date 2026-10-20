import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";

const components = [
  "../packages/ui/src/core/claude-extensions-pane.tsx",
  "../packages/ui/src/core/extension-center.tsx",
  "../packages/ui/src/core/extension-catalog.tsx",
  "../packages/ui/src/core/codex-official-plugins-pane.tsx",
];

it.each(components)("keeps each extension Tooltip slot on a single element: %s", (path) => {
  const source = ts.createSourceFile(
    path,
    readFileSync(new URL(path, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let triggers = 0;
  const visit = (node: ts.Node) => {
    if (
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(source) === "TooltipTrigger" &&
      node.openingElement.attributes.properties.some(
        (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "asChild",
      )
    ) {
      triggers++;
      // JSX 排版空白会被编译器忽略，显式 {" "} 则是实际 React 子节点，不能进入 Slot。
      const children = node.children.filter(
        (child) => !ts.isJsxText(child) || child.getText(source).trim() !== "",
      );
      const location = source.getLineAndCharacterOfPosition(node.getStart(source));
      expect(
        children,
        `${path}:${String(location.line + 1)} requires one slottable element`,
      ).toHaveLength(1);
      expect(
        children[0] && (ts.isJsxElement(children[0]) || ts.isJsxSelfClosingElement(children[0])),
      ).toBe(true);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  expect(triggers).toBeGreaterThan(0);
});
