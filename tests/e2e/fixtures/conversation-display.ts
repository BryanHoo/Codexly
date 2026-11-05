import type { Page } from "@playwright/test";

/** Existing summary-card flows explicitly exercise the optional grouped presentation. */
export async function useGroupedFileChanges(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const key = "codexly:conversation-display:v1";
    const current: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    const preferences = typeof current === "object" && current !== null ? current : {};
    localStorage.setItem(key, JSON.stringify({ ...preferences, independentFileDiffs: false }));
  });
}
