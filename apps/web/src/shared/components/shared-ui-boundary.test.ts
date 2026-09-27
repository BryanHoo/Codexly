import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const uiRoot = join(root, "packages/ui");
const primitives = [
  "button",
  "button-group",
  "checkbox",
  "collapsible",
  "context-menu",
  "dialog",
  "dropdown-menu",
  "input",
  "input-group",
  "select",
  "sheet",
  "textarea",
  "tooltip",
];

describe("共享 UI 边界", () => {
  it("两端基础控件只从独立包导出，不保留实现副本", () => {
    const manifest = JSON.parse(readFileSync(join(uiRoot, "package.json"), "utf8")) as {
      exports: Record<string, unknown>;
    };

    expect(manifest.exports["./core/*"]).toBeDefined();
    for (const name of primitives) {
      expect(existsSync(join(uiRoot, `src/core/${name}.tsx`))).toBe(true);
      for (const app of ["desktop", "apps/web"]) {
        const local = readFileSync(
          join(root, app, `src/shared/components/core/${name}.tsx`),
          "utf8",
        );
        expect(local.trim()).toBe(`export * from "@codexly/ui/core/${name}";`);
      }
    }
  });

  it("共享包不依赖平台实现，样式由两个客户端扫描", () => {
    const sources = readdirSync(join(uiRoot, "src/core"))
      .map((name) => readFileSync(join(uiRoot, "src/core", name), "utf8"))
      .join("\n");
    expect(sources).not.toMatch(/@tauri-apps|@codexly\/client|apps\/web|desktop\/src/u);
    for (const app of ["desktop", "apps/web"]) {
      const styles = readFileSync(join(root, app, "src/shared/styles/globals.css"), "utf8");
      expect(styles).toContain("@source");
      expect(styles).toContain("packages/ui/src");
    }
  });

  it("Message 展示共用实现，分支文案仍由各端提供", () => {
    expect(existsSync(join(uiRoot, "src/agent/message.tsx"))).toBe(true);
    const shared = readFileSync(join(uiRoot, "src/agent/message.tsx"), "utf8");
    expect(shared).not.toMatch(/useTranslation|@tauri-apps|@codexly\/client/u);
    for (const app of ["desktop", "apps/web"]) {
      const local = readFileSync(
        join(root, app, "src/shared/components/agent/message.tsx"),
        "utf8",
      );
      expect(local).toContain("@codexly/ui/agent/message");
      expect(local).toContain('useTranslation("conversation")');
      expect(local).not.toContain("createContext");
    }
  });

  it("Diff 共享渲染，平台各自准备补丁", () => {
    const shared = readFileSync(join(uiRoot, "src/agent/patch-diff-viewer.tsx"), "utf8");
    expect(shared).not.toMatch(/file-change|@tauri-apps|@codexly\/client/u);
    const web = readFileSync(
      join(root, "apps/web/src/features/diff/patch-diff-viewer.tsx"),
      "utf8",
    );
    const desktop = readFileSync(
      join(root, "desktop/src/features/diff/patch-diff-viewer.tsx"),
      "utf8",
    );
    expect(web).toContain("normalizeFileChangePatch(change)");
    expect(desktop).toContain("patch={change.diff}");
    expect(web).toContain("@codexly/ui/agent/patch-diff-viewer");
    expect(desktop).toContain("@codexly/ui/agent/patch-diff-viewer");
  });
});
