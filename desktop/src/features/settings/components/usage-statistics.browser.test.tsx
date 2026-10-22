import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TokenUsageQuery, TokenUsageResponse } from "@codexly/protocol";
import { UsageStatistics } from "@codexly/ui/core/usage-statistics";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import "../../../shared/styles/globals.css";
import "@codexly/ui/core/usage-statistics.css";

it.each([320, 390, 1440])("首次切换引擎即时筛选且不重挂统计区域、不新增年度请求（宽度 %i）", async (width) => {
  await page.viewport(width, 900);
  const year = new Date().getUTCFullYear();
  const day = `${String(year)}-01-01`;
  const counters = { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null };
  const data: TokenUsageResponse = {
    days: [
      { ...counters, day, engine: "codex", taskCount: 1, totalTokens: 12345 },
      { ...counters, day, engine: "claude", taskCount: 1, totalTokens: 23456 },
    ],
    tasks: [],
  };
  // 首次筛选若再次请求，就保持在途，确保不能靠本机快速响应掩盖整块加载闪烁。
  const getTokenUsage = vi.fn<(query: TokenUsageQuery) => Promise<TokenUsageResponse>>()
    .mockResolvedValueOnce(data)
    .mockImplementation(() => new Promise(() => {}));
  const queryClient = new QueryClient();
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <UsageStatistics client={{ getTokenUsage }} language="zh-CN" />
    </QueryClientProvider>,
  );
  try {
    await expect.element(screen.getByRole("heading", { name: "用量热力图", exact: true })).toBeVisible();
    const cards = [...document.querySelectorAll<HTMLElement>(".usage-overview > div")];
    expect(cards).toHaveLength(3);
    const bounds = cards.map((card) => card.getBoundingClientRect());
    expect(Math.max(...bounds.map((rect) => rect.width)) - Math.min(...bounds.map((rect) => rect.width))).toBeLessThan(1);
    expect(new Set(bounds.map((rect) => rect.height)).size).toBe(1);
    const values = [...document.querySelectorAll<HTMLElement>(".usage-metric-value")];
    expect(values).toHaveLength(3);
    expect(new Set(values.map((value) => getComputedStyle(value).fontSize)).size).toBe(1);
    expect(new Set(values.map((value) => value.getBoundingClientRect().top)).size).toBe(1);
    await expect.element(screen.getByText("让每一次与 AI 的协作，都有迹可循。", { exact: true })).not.toBeInTheDocument();
    const info = document.querySelector<HTMLDetailsElement>(".usage-info");
    expect(info?.open).toBe(false);
    await screen.getByText("统计说明", { exact: true }).click();
    expect(info?.open).toBe(true);
    await expect.element(screen.getByText(/按 UTC 日期记录引擎返回的实际用量/)).toBeVisible();
    await screen.getByText("统计说明", { exact: true }).click();
    expect(info?.open).toBe(false);
    const overview = document.querySelector(".usage-overview");
    const calendar = document.querySelector(".usage-calendar-scroll");
    for (const [name, total] of [["Codex", "12,345"], ["Claude", "23,456"], ["全部", "35,801"], ["Codex", "12,345"]] as const) {
      await screen.getByRole("button", { name, exact: true }).click();
      expect(document.querySelector(".usage-overview")).toBe(overview);
      expect(document.querySelector(".usage-calendar-scroll")).toBe(calendar);
      expect(document.querySelector(".usage-loading")).toBeNull();
      expect(document.querySelector(".usage-total-number")?.getAttribute("title")).toBe(total);
      expect(getTokenUsage).toHaveBeenCalledExactlyOnceWith({ year });
    }
  } finally {
    await screen.unmount();
    queryClient.clear();
  }
});
