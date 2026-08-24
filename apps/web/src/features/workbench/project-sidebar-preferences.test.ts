import { describe, expect, it } from "vitest";

import {
  readTemporaryTasksExpanded,
  readExpandedProjectIds,
  resolveInitialProjectId,
  resolveInitialExpandedProjectIds,
  writeTemporaryTasksExpanded,
  writeExpandedProjectIds,
} from "./project-sidebar-preferences.js";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("project sidebar preferences", () => {
  it("selects the first expanded project in project order for a new page", () => {
    expect(
      resolveInitialProjectId(
        ["project-1", "project-2", "project-3"],
        new Set(["project-2", "project-3"]),
      ),
    ).toBe("project-2");
    expect(resolveInitialProjectId(["project-1", "project-2"], new Set())).toBe("project-1");
  });

  it("expands only the first project when no preference exists", () => {
    expect([...resolveInitialExpandedProjectIds(["project-1", "project-2"], null)]).toEqual([
      "project-1",
    ]);
  });

  it("restores the saved folder shape and ignores removed projects", () => {
    expect([
      ...resolveInitialExpandedProjectIds(
        ["project-1", "project-2", "project-3"],
        new Set(["project-2", "removed-project"]),
      ),
    ]).toEqual(["project-2"]);
  });

  it("preserves a saved state where every project is collapsed", () => {
    expect([...resolveInitialExpandedProjectIds(["project-1", "project-2"], new Set())]).toEqual(
      [],
    );
  });

  it("round-trips expanded project identifiers through browser storage", () => {
    const storage = new MemoryStorage();

    writeExpandedProjectIds(storage, new Set(["project-1", "project-3"]));

    expect(readExpandedProjectIds(storage)).toEqual(new Set(["project-1", "project-3"]));
  });

  it("restores the collapsed temporary task folder through browser storage", () => {
    const storage = new MemoryStorage();

    writeTemporaryTasksExpanded(storage, false);

    expect(readTemporaryTasksExpanded(storage)).toBe(false);
  });

  it("defaults temporary tasks to expanded when no valid preference exists", () => {
    const storage = new MemoryStorage();

    expect(readTemporaryTasksExpanded(storage)).toBe(true);
    storage.values.set("code-agent:project-sidebar:temporary-tasks-expanded:v1", "invalid");
    expect(readTemporaryTasksExpanded(storage)).toBe(true);
  });

  it("falls back to defaults when saved data is malformed", () => {
    const storage = new MemoryStorage();
    storage.values.set("code-agent:project-sidebar:expanded-projects:v1", "not-json");

    expect(readExpandedProjectIds(storage)).toBeNull();
  });
});
