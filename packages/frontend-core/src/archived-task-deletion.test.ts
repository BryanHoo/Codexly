import { expect, test } from "vitest";
import {
  getArchivedTaskDeletionDate,
  parseArchivedTaskDeletionDate,
} from "./archived-task-deletion.js";

test("subtracts calendar months and clamps month-end and leap days", () => {
  expect(getArchivedTaskDeletionDate(3, new Date(2026, 9, 24, 14))).toBe("2026-07-24");
  expect(getArchivedTaskDeletionDate(6, new Date(2026, 9, 24))).toBe("2026-04-24");
  expect(getArchivedTaskDeletionDate(1, new Date(2026, 2, 31))).toBe("2026-02-28");
  expect(getArchivedTaskDeletionDate(12, new Date(2024, 1, 29))).toBe("2023-02-28");
});

test("converts a chosen date at local midnight, rather than UTC midnight", () => {
  expect(parseArchivedTaskDeletionDate("2026-07-24")).toBe(new Date(2026, 6, 24).toISOString());
});

test.each(["", "invalid", "2026-02-30", "2026-13-01", "2026-00-01", "2026-1-01"])(
  "rejects invalid custom dates without turning them into delete-all: %s",
  (value) => {
    expect(parseArchivedTaskDeletionDate(value)).toBeNull();
  },
);
