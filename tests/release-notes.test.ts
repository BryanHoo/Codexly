import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { extractReleaseNotes } from "../tools/extract-release-notes.mjs";

describe("extractReleaseNotes", () => {
  it("extracts only the requested version section", () => {
    const changelog = `# 更新日志

## [Unreleased]

- 尚未发布

## [1.2.0] - 2026-08-23

### 新增

- 添加当前版本功能

## [1.1.0] - 2026-08-20

- 上一版本内容
`;

    expect(extractReleaseNotes(changelog, "1.2.0")).toBe("### 新增\n\n- 添加当前版本功能");
  });

  it("rejects a version missing from the changelog", () => {
    expect(() => extractReleaseNotes("## [1.1.0] - 2026-08-20\n\n- 内容", "1.2.0")).toThrow(
      "CHANGELOG.md does not contain version 1.2.0",
    );
  });

  it("publishes the extracted notes through the release workflow", () => {
    const workflow = readFileSync(join(process.cwd(), ".github/workflows/release.yml"), "utf8");

    expect(workflow).toContain("node ./tools/extract-release-notes.mjs");
    expect(workflow).toContain('--notes-file "${RELEASE_NOTES_PATH}"');
    expect(workflow).not.toContain("--generate-notes");
  });

  it("keeps the release version and dated changelog section aligned", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      version: string;
    };
    const changelog = readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8");

    const releaseHeading = `## [${packageJson.version}] - `;
    expect(changelog).toMatch(
      new RegExp(
        `^## \\[${packageJson.version.replaceAll(".", "\\.")}\\] - \\d{4}-\\d{2}-\\d{2}$`,
        "m",
      ),
    );
    expect(changelog.split("## [Unreleased]")[1]?.split(releaseHeading)[0]?.trim()).toBe("");
    expect(extractReleaseNotes(changelog, packageJson.version).length).toBeGreaterThan(0);
  });
});
