import { CodexlyClient } from "@codexly/client";
import type { Route } from "@playwright/test";
import { expect, it } from "vitest";

import { projects } from "./e2e/fixtures/app-shell-data.js";
import { handleAppShellCoreRoute } from "./e2e/fixtures/app-shell-api-core.js";
import { createAppShellApiState } from "./e2e/fixtures/app-shell-api-state.js";

it("keeps the shared browser project fixtures valid at the client protocol boundary", async () => {
  const client = new CodexlyClient({
    fetch: () => Promise.resolve(Response.json({ data: projects, nextCursor: null })),
  });

  await expect(client.listProjects()).resolves.toEqual({ data: projects, nextCursor: null });
});

it("provides a valid disconnected Claude profile for browser engine discovery", async () => {
  let payload: unknown;
  const route = {
    request: () => ({ url: () => "http://localhost/v1/engines/claude", method: () => "GET" }),
    fulfill: (options: { json: unknown }) => {
      payload = options.json;
      return Promise.resolve();
    },
  } as unknown as Route;
  expect(await handleAppShellCoreRoute(route, createAppShellApiState({}))).toBe(true);
  const client = new CodexlyClient({ fetch: () => Promise.resolve(Response.json(payload)) });
  await expect(client.getEngineProfile("claude")).resolves.toMatchObject({
    engine: "claude",
    connection: { state: "disconnected" },
  });
});
