import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  AccessStatusResponseSchema,
  LogoutAccessResponseSchema,
  PairAccessRequestSchema,
  PairAccessResponseSchema,
} from "./access.js";

describe("Access protocol", () => {
  it("accepts only strict versioned access status responses", () => {
    expect(
      Value.Check(AccessStatusResponseSchema, { authenticated: true, mode: "local", version: 1 }),
    ).toBe(true);
    expect(
      Value.Check(AccessStatusResponseSchema, { authenticated: false, mode: "lan", version: 1 }),
    ).toBe(true);
    expect(
      Value.Check(AccessStatusResponseSchema, {
        authenticated: true,
        legacy: true,
        mode: "local",
        version: 1,
      }),
    ).toBe(false);
    expect(
      Value.Check(AccessStatusResponseSchema, {
        authenticated: true,
        mode: "remote",
        version: 1,
      }),
    ).toBe(false);
  });

  it("keeps pairing and logout payloads strict", () => {
    expect(Value.Check(PairAccessRequestSchema, { code: "pairing-code" })).toBe(true);
    expect(Value.Check(PairAccessRequestSchema, { code: "", extra: true })).toBe(false);
    expect(
      Value.Check(PairAccessResponseSchema, { authenticated: true, mode: "lan", version: 1 }),
    ).toBe(true);
    expect(
      Value.Check(LogoutAccessResponseSchema, { authenticated: false, mode: "lan", version: 1 }),
    ).toBe(true);
  });
});
