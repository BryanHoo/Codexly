import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ClaudeExtensionsPane } from "@codexly/ui/core/claude-extensions-pane";
import { TooltipProvider } from "@codexly/ui/core/tooltip";
import type { ClaudeExtensionMutation, ClaudeExtensionPage } from "@codexly/protocol";

it("disables and spins only the plugins being installed, including concurrent installations", async () => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const queryKey = ["extensions", "claude", "plugins", "global"];
  const page: ClaudeExtensionPage = {
    data: ["alpha", "beta", "gamma"].map((name) => ({
      id: name,
      name,
      scope: "user",
      installed: false,
      enabled: false,
      mutable: true,
      description: "Official plugin",
    })),
  };
  cache.setQueryData(queryKey, page);
  const releases: (() => void)[] = [];
  const requests: Promise<ClaudeExtensionPage>[] = [];
  const markup = () =>
    renderToStaticMarkup(
      <QueryClientProvider client={cache}>
        <TooltipProvider>
          <ClaudeExtensionsPane
            kind="plugins"
            client={{
              listClaudeExtensions: vi.fn(() => Promise.resolve(page)),
              mutateClaudeExtension: vi.fn(() => Promise.resolve(page)),
            }}
            t={(key) => key}
          />
        </TooltipProvider>
      </QueryClientProvider>,
    );
  const row = (html: string, name: string) =>
    html
      .match(/<li\b[\s\S]*?<\/li>/g)
      ?.find((item) => new RegExp(`<strong[^>]*>${name}</strong>`).test(item)) ?? "";
  const start = (id: string) => {
    const mutation = cache
      .getMutationCache()
      .build<ClaudeExtensionPage, Error, ClaudeExtensionMutation, unknown>(cache, {
        mutationKey: [...queryKey, "mutation"],
        mutationFn: () =>
          new Promise<ClaudeExtensionPage>((resolve) =>
            releases.push(() => {
              resolve(page);
            }),
          ),
      });
    requests.push(mutation.execute({ kind: "plugins", action: "install", id, scope: "user" }));
  };
  try {
    start("alpha");
    await Promise.resolve();
    let html = markup();
    expect(row(html, "alpha")).toContain('disabled=""');
    expect(row(html, "alpha")).toContain('aria-busy="true"');
    expect(row(html, "alpha")).toContain("animate-spin");
    expect(row(html, "beta")).not.toContain('disabled=""');
    const toolbar = html.split('class="extension-center__list-meta"')[0];
    expect(toolbar).not.toContain('disabled=""');
    start("beta");
    await Promise.resolve();
    html = markup();
    expect(row(html, "alpha")).toContain('disabled=""');
    expect(row(html, "beta")).toContain('disabled=""');
    expect(row(html, "gamma")).not.toContain('disabled=""');
    releases[0]?.();
    await requests[0];
    html = markup();
    expect(row(html, "alpha")).not.toContain('disabled=""');
    expect(row(html, "beta")).toContain('aria-busy="true"');
  } finally {
    releases.forEach((release) => {
      release();
    });
    await Promise.all(requests);
    cache.clear();
  }
});
