import { describe, expect, it } from "vitest";

import { isForkHistoryDeletionError } from "./task-deletion-error.js";

describe("isForkHistoryDeletionError", () => {
  const message =
    "cannot delete thread 01a03139-f883-73c1-abad-402de0de6252: forked history still references it";

  it.each([new Error(message), message, ` ${message}\n`])(
    "recognizes the native protection error: %s",
    (error) => {
      expect(isForkHistoryDeletionError(error)).toBe(true);
    },
  );

  it.each([
    null,
    undefined,
    {},
    new Error("thread not found: task-1"),
    new Error("cannot delete thread task-1: permission denied"),
    "forked history still references it",
    `Something else failed: ${message}`,
    `${message}; permission denied`,
  ])("does not replace unrelated errors: %s", (error) => {
    expect(isForkHistoryDeletionError(error)).toBe(false);
  });
});
