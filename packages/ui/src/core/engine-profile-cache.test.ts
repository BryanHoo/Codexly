import type { AgentEngineProfile } from "@codexly/protocol";
import { expect, it, vi } from "vitest";
it("reuses engine discovery between drafts, deduplicates split panes and refreshes after settings change", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  const { engineProfileQuery } = await import("@codexly/frontend-core/engine-settings-query");
  const client = new QueryClient();
  const profile = { engine: "claude" } as AgentEngineProfile;
  const load = vi.fn(() => Promise.resolve(profile));
  const options = engineProfileQuery(load, "claude", "p");
  const [first, split] = await Promise.all([
    client.fetchQuery(options),
    client.fetchQuery(options),
  ]);
  expect(first).toBe(profile);
  expect(split).toBe(profile);
  await client.fetchQuery(options);
  expect(load).toHaveBeenCalledTimes(1);
  await client.invalidateQueries({ queryKey: ["engine-profile"], refetchType: "none" });
  await client.fetchQuery(options);
  expect(load).toHaveBeenCalledTimes(2);
  await client.fetchQuery(engineProfileQuery(load, "claude", "other-project"));
  expect(load).toHaveBeenCalledTimes(3);
  client.clear();
});
