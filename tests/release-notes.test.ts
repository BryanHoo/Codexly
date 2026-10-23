import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { extractReleaseNotes } from "../tools/extract-release-notes.mjs";

describe("extractReleaseNotes", () => {
  it.each(["", "- 尚未发布"])(
    "extracts only the requested version with Unreleased %j",
    (pending) => {
      const changelog = `# 更新日志

## [Unreleased]

${pending}

## [1.2.0] - 2026-08-23

### 新增

- 添加当前版本功能

## [1.1.0] - 2026-08-20

- 上一版本内容
`;

      expect(extractReleaseNotes(changelog, "1.2.0")).toBe("### 新增\n\n- 添加当前版本功能");
    },
  );

  it("rejects a version missing from the changelog", () => {
    expect(() => extractReleaseNotes("## [1.1.0] - 2026-08-20\n\n- 内容", "1.2.0")).toThrow(
      "CHANGELOG.md does not contain version 1.2.0",
    );
  });

  it("publishes the extracted notes through the release workflow", () => {
    const workflow = readFileSync(join(process.cwd(), ".github/workflows/release.yml"), "utf8");

    expect(workflow).toContain("node ./tools/joint-release.mjs --notes");
    expect(workflow).toContain("--draft=false");
    expect(workflow).toContain('--notes-file "${RELEASE_NOTES_PATH}"');
    expect(workflow).not.toContain("--generate-notes");
  });

  it("keeps the release version and dated changelog section aligned", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      version: string;
    };
    const changelog = readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8");

    expect(changelog).toMatch(
      new RegExp(
        `^## \\[${packageJson.version.replaceAll(".", "\\.")}\\] - \\d{4}-\\d{2}-\\d{2}$`,
        "m",
      ),
    );
    // 开发期间允许积累未发布变更；发布说明仍按指定版本提取，不混入 Unreleased。
    expect(changelog).toMatch(/^## \[Unreleased\]$/m);
    expect(extractReleaseNotes(changelog, packageJson.version).length).toBeGreaterThan(0);
  });
});
