import { CodexlyClient } from "@codexly/client";
import { expect, it } from "vitest";

import { projects } from "./e2e/fixtures/app-shell-data.js";

it("keeps the shared browser project fixtures valid at the client protocol boundary", async () => {
  const client = new CodexlyClient({
    fetch: () => Promise.resolve(Response.json({ data: projects, nextCursor: null })),
  });

  await expect(client.listProjects()).resolves.toEqual({ data: projects, nextCursor: null });
});
