import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { UsageStatistics } from "@codexly/ui/core/usage-statistics";

test("renders real total-only data without manufacturing token categories or making background requests", () => {
  const queryClient = new QueryClient();
  const year = new Date().getUTCFullYear();
  queryClient.setQueryData(["token-usage", year], {
    days: [
      {
        day: `${String(year)}-01-01`,
        engine: "codex",
        taskCount: 1,
        totalTokens: 12345,
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
      },
    ],
    tasks: [],
  });
  const client = { getTokenUsage: vi.fn() };
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <UsageStatistics client={client} language="zh-CN" />
    </QueryClientProvider>,
  );
  expect(markup).toContain('title="12,345"');
  expect(markup).toContain("用量热力图");
  expect(markup).toContain('type="date"');
  expect(markup).not.toContain('class="usage-breakdown"');
  expect(client.getTokenUsage).not.toHaveBeenCalled();
  queryClient.clear();
});
