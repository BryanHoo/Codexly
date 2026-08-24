import { describe, expect, it, vi } from "vitest";

import { AccessSessionService } from "./access-control.js";

describe("AccessSessionService", () => {
  it("keeps sessions valid for the server lifetime when no TTL is configured", () => {
    let now = 1_000;
    const service = new AccessSessionService(
      { pairingCode: "correct-code" },
      { now: () => now, randomBytes: () => Buffer.alloc(32, 1) },
    );

    const result = service.pair("correct-code", "192.168.1.10");

    expect(result).toMatchObject({ expiresAt: null, status: "paired" });
    now = Number.MAX_SAFE_INTEGER;
    expect(result.status === "paired" && service.validate(result.sessionId)).toBe(true);
    expect(result.status === "paired" && service.expiresAt(result.sessionId)).toBeNull();
  });

  it("issues independent sessions with one fixed absolute expiry", () => {
    let now = 1_000;
    let sequence = 0;
    const service = new AccessSessionService(
      { pairingCode: "correct-code", sessionTtlMs: 60_000 },
      {
        now: () => now,
        randomBytes: () => Buffer.alloc(32, (sequence += 1)),
      },
    );

    const first = service.pair("correct-code", "192.168.1.10");
    const second = service.pair("correct-code", "192.168.1.11");

    expect(first).toMatchObject({ expiresAt: 61_000, status: "paired" });
    expect(second).toMatchObject({ expiresAt: 61_000, status: "paired" });
    expect(first.status === "paired" && second.status === "paired" && first.sessionId).not.toBe(
      second.status === "paired" ? second.sessionId : undefined,
    );
    expect(first.status === "paired" && service.validate(first.sessionId)).toBe(true);

    now = 60_999;
    expect(first.status === "paired" && service.validate(first.sessionId)).toBe(true);
    now = 61_000;
    expect(first.status === "paired" && service.validate(first.sessionId)).toBe(false);
  });

  it("rate limits failed pairing attempts per remote address", () => {
    let now = 1_000;
    const service = new AccessSessionService(
      { pairingCode: "correct-code", sessionTtlMs: 60_000 },
      { now: () => now },
    );

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(service.pair("wrong-code", "192.168.1.10")).toEqual({ status: "failed" });
    }
    expect(service.pair("correct-code", "192.168.1.10")).toEqual({ status: "rate_limited" });
    expect(service.pair("correct-code", "192.168.1.11")).toMatchObject({ status: "paired" });

    now += 60_000;
    expect(service.pair("correct-code", "192.168.1.10")).toMatchObject({ status: "paired" });
  });

  it("bounds in-memory state and clears it on close", () => {
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    let sequence = 0;
    const service = new AccessSessionService(
      { pairingCode: "correct-code", sessionTtlMs: 60_000 },
      {
        maxFailureWindows: 2,
        maxSessions: 2,
        randomBytes: () => Buffer.alloc(32, (sequence += 1)),
      },
    );

    service.pair("wrong", "192.168.1.1");
    service.pair("wrong", "192.168.1.2");
    service.pair("wrong", "192.168.1.3");
    service.pair("correct-code", "192.168.1.1");
    service.pair("correct-code", "192.168.1.2");
    service.pair("correct-code", "192.168.1.3");

    expect(service.diagnostics()).toEqual({ failureWindows: 2, sessions: 2 });
    service.close();
    expect(service.diagnostics()).toEqual({ failureWindows: 0, sessions: 0 });
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });
});
