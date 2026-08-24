import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const webRoot = join(repositoryRoot, "apps/web");

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectSourceFiles(path);
    }
    return [".ts", ".tsx", ".css"].includes(extname(entry.name)) ? [path] : [];
  });
}

describe("项目自有组件库边界", () => {
  it("移除上游组件配置、依赖、旧目录和旧导入", () => {
    const packageJson = readFileSync(join(webRoot, "package.json"), "utf8");
    const skillsLock = readFileSync(join(repositoryRoot, "skills-lock.json"), "utf8");
    const source = collectSourceFiles(join(webRoot, "src"))
      .filter((path) => !path.endsWith("component-library-boundary.test.ts"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(existsSync(join(webRoot, "components.json"))).toBe(false);
    expect(existsSync(join(webRoot, "src/shared/ui"))).toBe(false);
    expect(existsSync(join(webRoot, "src/shared/ai-elements"))).toBe(false);
    expect(existsSync(join(webRoot, "src/shared/components/core"))).toBe(true);
    expect(existsSync(join(webRoot, "src/shared/components/agent"))).toBe(true);
    expect(existsSync(join(repositoryRoot, ".agents/skills/shadcn"))).toBe(false);
    expect(existsSync(join(repositoryRoot, ".agents/skills/ai-elements"))).toBe(false);
    expect(packageJson).not.toMatch(/"shadcn"\s*:/u);
    expect(skillsLock).not.toMatch(/"(?:shadcn|ai-elements)"\s*:/u);
    expect(source).not.toMatch(/shared\/(?:ui|ai-elements)\//u);
    expect(source).not.toContain('from "shadcn');
    expect(source).not.toContain('@import "shadcn');
  });
});
