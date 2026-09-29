import { describe, expect, it, vi } from "vitest";
import { AccessSessionService } from "./access-control.js";

describe("session invalidation", () => {
  it.each(["logout", "eviction", "validation", "pruning", "close"] as const)(
    "notifies all active listeners once on %s",
    (cause) => {
      let now = 0;
      const service = new AccessSessionService(
        { pairingCode: "code", sessionTtlMs: 100 },
        { maxSessions: 1, now: () => now },
      );
      try {
        const session = service.pair("code", "localhost");
        if (session.status !== "paired") throw new Error("Pairing failed");
        const first = vi.fn();
        const second = vi.fn();
        const detached = vi.fn();
        service.onInvalidated(session.sessionId, first);
        const detachSecond = service.onInvalidated(session.sessionId, second);
        service.onInvalidated(session.sessionId, detached)();
        // 通知期间连接会解除自身监听，不能导致其余连接漏收失效通知。
        second.mockImplementation(detachSecond);
        if (cause === "logout") service.logout(session.sessionId);
        if (cause === "eviction") service.pair("code", "localhost");
        if (cause === "validation" || cause === "pruning") now = 100;
        if (cause === "validation") service.validate(session.sessionId);
        if (cause === "pruning") service.pair("wrong", "localhost");
        if (cause === "close") service.close();
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
        expect(detached).not.toHaveBeenCalled();
        expect(service.validate(session.sessionId)).toBe(false);
        service.logout(session.sessionId);
        expect(first).toHaveBeenCalledTimes(1);
        const late = vi.fn();
        service.onInvalidated(session.sessionId, late);
        expect(late).toHaveBeenCalledTimes(1);
      } finally {
        service.close();
      }
    },
  );
});
