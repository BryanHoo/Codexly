import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const root = fileURLToPath(new URL("../", import.meta.url));
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? files(path)
      : path.endsWith(".tsx") && !/\.(test|browser|fixture)\./.test(path)
        ? [path]
        : [];
  });
}
test("所有业务模态弹窗使用通用组件及本地化关闭入口", () => {
  // 遍历两端及共享业务组件，防止新增弹窗绕过统一关闭入口与提交保护。
  const failures = [];
  for (const path of ["packages/ui/src", "apps/web/src", "desktop/src"].flatMap((dir) =>
    files(join(root, dir)),
  )) {
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const name = relative(root, path).replaceAll("\\", "/");
    const primitive =
      name === "packages/ui/src/core/dialog.tsx" ||
      name === "packages/ui/src/core/dialog-surface.tsx" ||
      name === "packages/ui/src/core/drawer.tsx" ||
      name === "packages/ui/src/core/drawer-surface.tsx";
    function visit(node) {
      if (
        !primitive &&
        ts.isImportDeclaration(node) &&
        /(?:@base-ui\/react\/(?:dialog|drawer)|radix-ui\/(?:dialog|alert-dialog)|@radix-ui\/react-(?:dialog|alert-dialog))$/.test(
          node.moduleSpecifier.text,
        )
      )
        failures.push(`${name}: 绕过通用弹窗组件`);
      if (!primitive && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))) {
        const tag = node.tagName.getText(source);
        const attributes = node.attributes.properties;
        if (
          ["DialogContent", "DrawerContent"].includes(tag) &&
          !attributes.some((attr) => attr.name?.getText(source) === "closeLabel")
        )
          failures.push(`${name}: ${tag} 缺少本地化 closeLabel`);
        if (
          attributes.some(
            (attr) =>
              attr.name?.getText(source) === "role" &&
              attr.initializer &&
              ts.isStringLiteral(attr.initializer) &&
              attr.initializer.text === "dialog",
          ) &&
          tag !== "PopoverContent"
        )
          failures.push(`${name}: 手写 dialog 角色`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.deepEqual(failures, []);
});
