import { describe, expect, it } from "vitest";

import {
  buildClawhubCatalogUrl,
  parseClawhubCatalogPage,
  parseClawhubSkillDetail,
} from "./skill-market-catalog.js";
import { isCodexCompatibleSkill } from "./skill-market-compatibility.js";

describe("ClawHub catalog mapping", () => {
  it("builds bounded browse and search URLs", () => {
    const browse = buildClawhubCatalogUrl("", "next page", "downloads");
    expect(browse.pathname).toBe("/api/v1/packages");
    expect(Object.fromEntries(browse.searchParams)).toEqual({
      cursor: "next page",
      family: "skill",
      limit: "24",
      sort: "downloads",
    });

    const search = buildClawhubCatalogUrl(" review ".repeat(30), null, "updated");
    expect(search.pathname).toBe("/api/v1/packages/search");
    expect(search.searchParams.get("q")?.length).toBe(120);
    expect(search.searchParams.has("cursor")).toBe(false);
  });

  it("keeps only complete Skill packages", () => {
    const page = parseClawhubCatalogPage(
      {
        items: [
          {
            displayName: "Code Review",
            family: "skill",
            latestVersion: "1.2.0",
            name: "code-review",
            ownerHandle: "codex",
            stats: { downloads: 120, stars: 8, versions: 3 },
            summary: "Review code changes.",
            topics: ["Review"],
            updatedAt: 1_788_400_000_000,
          },
          { family: "code-plugin", name: "plugin", ownerHandle: "codex" },
        ],
        nextCursor: "cursor-a",
      },
      false,
    );

    expect(page).toEqual({
      items: [
        {
          canonicalUrl: "https://clawhub.ai/codex/skills/code-review",
          displayName: "Code Review",
          downloads: 120,
          id: "codex/code-review",
          latestVersion: "1.2.0",
          owner: "codex",
          slug: "code-review",
          stars: 8,
          summary: "Review code changes.",
          topics: ["Review"],
          updatedAt: 1_788_400_000_000,
          versionCount: 3,
        },
      ],
      nextCursor: "cursor-a",
    });
  });

  it("maps detail, versions and security status", () => {
    const detail = parseClawhubSkillDetail(
      {
        latestVersion: { changelog: "Improve checks", version: "1.2.0" },
        owner: { handle: "codex" },
        skill: {
          displayName: "Code Review",
          slug: "code-review",
          stats: { downloads: 120, stars: 8, versions: 3 },
          summary: "Review code changes.",
          topics: ["Review"],
          updatedAt: 1_788_400_000_000,
        },
      },
      { items: [{ changelog: "Initial", createdAt: 10, version: "1.2.0" }] },
      { security: { hasWarnings: false, status: "clean" } },
      "---\nname: code-review\ndescription: Review code.\n---\n",
    );
    expect(detail.readme).toContain("name: code-review");
    expect(detail).toMatchObject({
      changelog: "Improve checks",
      hasWarnings: false,
      id: "codex/code-review",
      scanStatus: "clean",
      versions: [{ changelog: "Initial", createdAt: 10, version: "1.2.0" }],
    });
  });
});

describe("Skill compatibility", () => {
  it("accepts portable Agent Skills and rejects OpenClaw runtime dependencies", () => {
    expect(
      isCodexCompatibleSkill(
        "---\nname: review\ndescription: Review code changes.\nversion: 1.0.0\n---\n",
      ),
    ).toBe(true);
    expect(
      isCodexCompatibleSkill(
        "---\nname: gateway\ndescription: Configure gateway.\nmetadata:\n  openclaw:\n    requires:\n      bins: [openclaw]\n---\n",
      ),
    ).toBe(false);
  });
});
