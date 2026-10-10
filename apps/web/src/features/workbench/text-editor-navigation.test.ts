import { createMemoryHistory } from "@tanstack/react-router";
import { expect, it, vi, afterEach } from "vitest";
import { blockTextEditorNavigation } from "@codexly/frontend-core/text-editor-navigation";
afterEach(() => {
  vi.unstubAllGlobals();
});
it("keeps unsaved editors mounted during navigation and releases the blocker after closing", async () => {
  vi.stubGlobal("document", {});
  const history = createMemoryHistory({ initialEntries: ["/project"] });
  let dirty = true;
  const cleanup = blockTextEditorNavigation(history, () => dirty);
  history.push("/other");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(history.location.pathname).toBe("/project");
  dirty = false;
  history.push("/saved");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(history.location.pathname).toBe("/saved");
  dirty = true;
  cleanup();
  history.push("/closed");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(history.location.pathname).toBe("/closed");
});

it("waits for auto-save before navigation and keeps the editor on a failed save", async () => {
  vi.stubGlobal("document", {});
  const history = createMemoryHistory({ initialEntries: ["/project"] });
  let resolve!: (saved: boolean) => void;
  const save = vi.fn(
    () =>
      new Promise<boolean>((done) => {
        resolve = done;
      }),
  );
  const cleanup = blockTextEditorNavigation(history, () => true, save);
  history.push("/saved");
  await vi.waitFor(() => {
    expect(save).toHaveBeenCalledTimes(1);
  });
  expect(history.location.pathname).toBe("/project");
  resolve(false);
  await new Promise((done) => setTimeout(done, 0));
  expect(history.location.pathname).toBe("/project");
  history.push("/saved");
  await vi.waitFor(() => {
    expect(save).toHaveBeenCalledTimes(2);
  });
  resolve(true);
  await vi.waitFor(() => {
    expect(history.location.pathname).toBe("/saved");
  });
  cleanup();
});
