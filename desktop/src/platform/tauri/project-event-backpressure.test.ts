import { expect, it, vi } from "vitest";
import { subscribeProjectEvents } from "./project-event-subscription.js";
import type { AgentEventSubscription } from "./runtime.js";

it("recovers a subscribed project when the global native transport budget overflows", () => {
  let subscription: AgentEventSubscription | undefined;
  const onResyncRequired = vi.fn();
  subscribeProjectEvents((value) => { subscription = value; return () => {}; }, new Map(), {
    afterSequence: 3, projectId: "project-a", sessionId: "codeagent-runtime",
    onEvent: vi.fn(), onResyncRequired,
  });
  subscription?.onResyncRequired?.({
    projectId: "*", latestSequence: 0, reason: "event_retention_exceeded",
    sessionId: "codeagent-runtime", type: "resync.required", version: 3,
  });
  expect(onResyncRequired).toHaveBeenCalledOnce();
});
