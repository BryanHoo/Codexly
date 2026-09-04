import { describe, expect, it, vi } from "vitest";

import { createClawhubClient } from "./skill-market-client.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status,
  });
}

const portableReadme = "---\nname: review\ndescription: Review code changes.\n---\n# Review\n";

describe("ClawHubClient", () => {
  it("lists Skills and loads all detail resources", async () => {
    const fetch = vi.fn((input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname === "/api/v1/packages") {
        return Promise.resolve(
          jsonResponse({
            items: [
              {
                family: "skill",
                latestVersion: "1.2.0",
                name: "review",
                ownerHandle: "codex",
                stats: {},
              },
            ],
            nextCursor: null,
          }),
        );
      }
      if (url.pathname.endsWith("/versions")) {
        return Promise.resolve(
          jsonResponse({ items: [{ changelog: "Initial", createdAt: 1, version: "1.2.0" }] }),
        );
      }
      if (url.pathname.endsWith("/scan")) {
        return Promise.resolve(jsonResponse({ security: { hasWarnings: false, status: "clean" } }));
      }
      if (url.pathname.endsWith("/file")) {
        return Promise.resolve(jsonResponse({ content: portableReadme }));
      }
      return Promise.resolve(
        jsonResponse({
          latestVersion: { changelog: "Improve", version: "1.2.0" },
          owner: { handle: "codex" },
          skill: { slug: "review", stats: {} },
        }),
      );
    });
    const client = createClawhubClient({ fetch });

    await expect(client.listSkills("", null, "recommended")).resolves.toMatchObject({
      items: [{ id: "codex/review" }],
    });
    await expect(client.getSkill("codex", "review")).resolves.toMatchObject({
      id: "codex/review",
      readme: portableReadme,
      scanStatus: "clean",
    });
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it("accepts only verified public GitHub archive handoffs", async () => {
    const archive = new Uint8Array([80, 75, 3, 4]);
    const fetch = vi.fn((input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.hostname === "codeload.github.com") return Promise.resolve(new Response(archive));
      return Promise.resolve(
        jsonResponse({
          archiveUrl: "https://codeload.github.com/codex/review/zip/main",
          contentHash: "a".repeat(64),
          path: "skills/review",
          sourceRef: "public-github",
        }),
      );
    });
    const client = createClawhubClient({ fetch });

    await expect(client.downloadArchive("codex", "review", "1.2.0")).resolves.toEqual({
      bytes: archive,
      contentHash: "a".repeat(64),
      sourcePath: "skills/review",
    });
  });

  it("maps rate limits and rejects invalid owners before network access", async () => {
    const fetch = vi.fn(() => Promise.resolve(jsonResponse({}, 429)));
    const client = createClawhubClient({ fetch });

    await expect(client.listSkills("", null, "recommended")).rejects.toMatchObject({
      code: "SKILL_MARKET_RATE_LIMITED",
    });
    await expect(client.getSkill("../owner", "review")).rejects.toMatchObject({
      code: "SKILL_MARKET_INVALID_RESPONSE",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
