import presetEnv from "postcss-preset-env";

function insideSupports(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === "atrule" && parent.name === "supports") return true;
  }
  return false;
}

function surfaceFallback(declaration) {
  const { prop, value } = declaration;
  if (prop === "--ui-color-raised" || prop === "--ui-color-floating-surface") {
    return "var(--ui-color-wallpaper-overlay)";
  }
  if (prop === "background" || prop === "background-color") {
    return value.includes("--ui-color-raised")
      ? "var(--ui-color-raised)" : "var(--ui-color-content)";
  }
  if (prop === "color") {
    return value.includes("--task-board-tone") ? "var(--task-board-tone)" : "var(--ui-color-text)";
  }
  if (prop === "box-shadow") return "var(--ui-shadow-control)";
  if (prop === "border-color") return "var(--ui-color-separator-strong)";
  if (prop === "border") return "1px solid var(--ui-color-separator)";
  throw declaration.error(`Missing Legacy fallback for ${prop}: ${value}`);
}

export function legacyCssPlugins() {
  return [
    {
      postcssPlugin: "codeagent-legacy-surfaces",
      Once(root) {
        root.walkDecls((declaration) => {
          // 构建器无法计算运行时变量的混色；旧系统使用明确的实色表面，不执行逐帧 JS 模拟。
          // 已有 @supports 保护的 Tailwind 回退保持原样，未来未知属性直接阻止构建。
          if (declaration.value.includes("color-mix(")
            && declaration.value.includes("var(") && !insideSupports(declaration)) {
            declaration.value = surfaceFallback(declaration);
          }
        });
      },
    },
    presetEnv({
      browsers: ["Safari 15.5"],
      stage: 2,
      preserve: false,
      features: {
        "nesting-rules": true,
        "light-dark-function": true,
        "has-pseudo-class": false,
        "custom-properties": false,
      },
    }),
  ];
}
