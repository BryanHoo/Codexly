import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { TooltipProvider } from "../core/tooltip.js";

// 集中维护拆分测试共享的样本、mock 与生命周期钩子。
export function renderWithTooltipProvider(children: ReactNode) {
  return renderToStaticMarkup(<TooltipProvider>{children}</TooltipProvider>);
}

export function resolveStreamdownMermaidVersion(): string {
  // 从 streamdown 的真实安装位置解析生产依赖，避免测试误读根目录中的其他 Mermaid 版本。
  const streamdownPackagePath = realpathSync(
    new URL("../../../../node_modules/streamdown/package.json", import.meta.url),
  );
  const requireFromStreamdown = createRequire(streamdownPackagePath);
  const mermaidPackage = JSON.parse(
    readFileSync(requireFromStreamdown.resolve("mermaid/package.json"), "utf8"),
  ) as { version?: unknown };

  if (typeof mermaidPackage.version !== "string") {
    throw new TypeError("streamdown Mermaid package version is missing");
  }

  return mermaidPackage.version;
}

export function resolveStreamdownDompurifyVersion(): string {
  // 沿生产依赖链解析 DOMPurify，确保安全断言覆盖 Streamdown 实际使用的版本。
  const streamdownPackagePath = realpathSync(
    new URL("../../../../node_modules/streamdown/package.json", import.meta.url),
  );
  const requireFromStreamdown = createRequire(streamdownPackagePath);
  const mermaidPackagePath = requireFromStreamdown.resolve("mermaid/package.json");
  const requireFromMermaid = createRequire(mermaidPackagePath);
  const dompurifyEntryPath = requireFromMermaid.resolve("dompurify");
  const dompurifyPackage = JSON.parse(
    readFileSync(resolve(dirname(dompurifyEntryPath), "../package.json"), "utf8"),
  ) as { version?: unknown };

  if (typeof dompurifyPackage.version !== "string") {
    throw new TypeError("streamdown DOMPurify package version is missing");
  }

  return dompurifyPackage.version;
}
