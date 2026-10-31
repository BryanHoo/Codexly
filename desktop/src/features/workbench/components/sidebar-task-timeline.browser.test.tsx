import { SidebarTaskTimeline } from "@codexly/ui/core/sidebar-task-timeline";
import { upsertSidebarTaskCatalog } from "@codexly/ui/core/sidebar-task-catalog-cache";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";
import "../../../shared/styles/globals.css";

const labels = { title: "任务时间线", loading: "加载中", empty: "暂无任务", error: "加载失败", retry: "重试",
  groups: { today: "今天", yesterday: "昨天", week: "近 7 天", earlier: "更早" } };

describe("共享侧栏任务时间线", () => {
  afterEach(() => vi.useRealTimers());
  it.each([10, 1000])("每组 %i 条任务时标题吸顶、组边界替换且吸顶标题仍可折叠", async count => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const now = new Date();
    const tasks = [0, 1].flatMap(day => Array.from({ length: count }, (_, index) => ({
      id: `${day}-${index}`, projectId: "a", title: `任务 ${day}-${index}`, pinned: false,
      updatedAt: new Date(new Date(now.getFullYear(), now.getMonth(), now.getDate() - day, 12).getTime() - index * 1000).toISOString(),
    })));
    const screen = await render(<QueryClientProvider client={client}><div style={{ width: 280, height: 160, display: "flex", flexDirection: "column" }}>
      <SidebarTaskTimeline labels={labels} queries={[{ queryKey: ["sticky-test"], queryFn: async () => tasks }]}
        renderTask={task => <a className="block h-8" href={`#${task.id}`}>{task.title}</a>} />
    </div></QueryClientProvider>);
    const today = screen.getByRole("button", { name: new RegExp(`今天 ${count}$`) });
    await expect.element(today).toBeVisible();
    const scroll = screen.getByTestId("sidebar-task-timeline").element() as HTMLElement;
    const top = scroll.getBoundingClientRect().top;
    const first = screen.getByRole("link", { name: "任务 0-0", exact: true });
    await expect.element(first).toBeVisible();
    expect(first.element().getBoundingClientRect().top).toBeCloseTo(top + 32, 0);
    scroll.scrollTop = 80;
    await expect.poll(() => today.element().getBoundingClientRect().top, { timeout: 1500 }).toBeCloseTo(top, 0);
    const groupHeight = (count + 1) * 32;
    scroll.scrollTop = groupHeight - 16;
    const yesterday = screen.getByRole("button", { name: new RegExp(`昨天 ${count}$`) });
    await expect.poll(() => yesterday.element().getBoundingClientRect().top).toBeCloseTo(top + 16, 0);
    expect(today.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(yesterday.element().getBoundingClientRect().top + 1);
    scroll.scrollTop = groupHeight + 64;
    await expect.poll(() => yesterday.element().getBoundingClientRect().top).toBeCloseTo(top, 0);
    expect(screen.container.querySelectorAll("a").length).toBeLessThan(40);
    await yesterday.click();
    await expect.element(yesterday).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("link", { name: "任务 1-0", exact: true }).query()).toBeNull();
    client.clear();
  });

  it("默认收起更早且不请求完整历史，展开后才加载任务", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const todayTask = { id: "today", projectId: "a", title: "今日任务", pinned: false, updatedAt: new Date().toISOString() };
    const oldTask = { ...todayTask, id: "old", title: "较早任务", updatedAt: "2020-01-01T00:00:00Z" };
    const full = vi.fn().mockResolvedValue([todayTask, oldTask]);
    const recent = vi.fn().mockResolvedValue({ tasks: [todayTask], hasEarlier: true, earlierCount: null });
    const screen = await render(<QueryClientProvider client={client}><div style={{ height: 320, display: "flex", flexDirection: "column" }}>
      <SidebarTaskTimeline labels={labels} queries={[{ queryKey: ["projects", "a", "tasks", "search-source"], queryFn: full, recentQueryFn: recent }]}
        renderTask={task => <a href={`#${task.id}`}>{task.title}</a>} />
    </div></QueryClientProvider>);
    await expect.element(screen.getByRole("link", { name: "今日任务" })).toBeVisible();
    const earlier = screen.getByRole("button", { name: /更早/ });
    await expect.element(earlier).toHaveAttribute("aria-expanded", "false");
    expect(full).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "较早任务" }).query()).toBeNull();
    recent.mockResolvedValue({ tasks: [{ ...todayTask, title: "更新后的任务" }], hasEarlier: true, earlierCount: null });
    upsertSidebarTaskCatalog(client, { ...todayTask, title: "更新后的任务" });
    await expect.element(screen.getByRole("link", { name: "更新后的任务" })).toBeVisible();
    expect(full).not.toHaveBeenCalled();
    await earlier.click();
    await expect.element(screen.getByRole("link", { name: "较早任务" })).toBeVisible();
    expect(full).toHaveBeenCalledOnce();
    await expect.element(earlier).toHaveTextContent("更早1");
    await earlier.click();
    expect(screen.getByRole("link", { name: "较早任务" }).query()).toBeNull();
    await earlier.click();
    expect(full).toHaveBeenCalledOnce();
    await earlier.click();
    await client.invalidateQueries({ exact: true, queryKey: ["projects", "a", "tasks", "search-source"] });
    expect(full).toHaveBeenCalledOnce();
    client.clear();
  });

  it("历史部分加载失败时保留成功项目的历史与失败项目的近期任务", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const task = (id: string, projectId: string, updatedAt = new Date().toISOString()) => ({ id, projectId, title: id, pinned: false, updatedAt });
    const recentA = task("近期 A", "a"), recentB = task("近期 B", "b");
    const oldA = task("历史 A", "a", "2020-01-01T00:00:00Z"), oldB = task("历史 B", "b", "2020-01-01T00:00:00Z");
    const loadB = vi.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValue([recentB, oldB]);
    const screen = await render(<QueryClientProvider client={client}><SidebarTaskTimeline labels={labels}
      queries={[
        { queryKey: ["projects", "a", "tasks", "search-source"], queryFn: async () => [recentA, oldA], recentQueryFn: async () => ({ tasks: [recentA], hasEarlier: true, earlierCount: null }) },
        { queryKey: ["projects", "b", "tasks", "search-source"], queryFn: loadB, recentQueryFn: async () => ({ tasks: [recentB], hasEarlier: true, earlierCount: null }) },
      ]} renderTask={task => <a href={`#${task.id}`}>{task.title}</a>} /></QueryClientProvider>);
    await screen.getByRole("button", { name: /更早/ }).click();
    await expect.element(screen.getByRole("alert")).toHaveTextContent("加载失败");
    await expect.element(screen.getByRole("link", { name: "历史 A" })).toBeVisible();
    await expect.element(screen.getByRole("link", { name: "近期 B" })).toBeVisible();
    await screen.getByRole("button", { name: "重试" }).click();
    await expect.element(screen.getByRole("link", { name: "历史 B" })).toBeVisible();
    expect(screen.container.querySelectorAll('[data-timeline-row="heading:earlier"]')).toHaveLength(1);
    client.clear();
  });

  it("分组标题更醒目、数量靠右，独立折叠并在重新打开后恢复", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const now = new Date();
    const tasks = [
      { id: "today", projectId: "a", title: "今日任务", pinned: false, updatedAt: now.toISOString() },
      { id: "yesterday", projectId: "a", title: "昨日任务", pinned: false, updatedAt: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12).toISOString() },
    ];
    const queries = [{ queryKey: ["collapse-test"], queryFn: async () => tasks }];
    const view = (key: string) => <QueryClientProvider client={client}><div style={{ width: 280, height: 320, display: "flex", flexDirection: "column" }}>
      <SidebarTaskTimeline key={key} storage={storage} labels={labels} queries={queries}
        renderTask={task => <a className="block h-8" href={`#${task.id}`}>{task.title}</a>} />
    </div></QueryClientProvider>;
    const screen = await render(view("first"));
    const today = screen.getByRole("button", { name: "今天 1", exact: true });
    await expect.element(today).toHaveAttribute("aria-expanded", "true");
    const button = today.element();
    const title = button.querySelector("[data-timeline-group-title]");
    const count = button.querySelector("[data-timeline-group-count]");
    expect(title).not.toBeNull();
    expect(count).not.toBeNull();
    if (!title || !count) throw Error("时间分组标题或数量缺失");
    expect(Number(getComputedStyle(title).fontWeight)).toBeGreaterThanOrEqual(600);
    expect(getComputedStyle(button).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(button.getBoundingClientRect().right - count.getBoundingClientRect().right).toBeLessThanOrEqual(12);
    await today.click();
    await expect.element(today).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("link", { name: "今日任务" }).query()).toBeNull();
    await expect.element(screen.getByRole("link", { name: "昨日任务" })).toBeVisible();
    await screen.rerender(view("reopened"));
    await expect.element(today).toHaveAttribute("aria-expanded", "false");
    await today.click();
    await expect.element(screen.getByRole("link", { name: "今日任务" })).toBeVisible();
    expect(client.getQueryData(["collapse-test"])).toHaveLength(2);
    client.clear();
  });

  it.each([0, 12])("%i 时：大量历史只挂载可见行，并支持键盘导航至末项与回到首项", async hour => {
    // 覆盖 CI 的午夜和本地白天，避免单组折叠断言依赖执行时刻；只模拟 Date，保留真实浏览器定时器。
    vi.setSystemTime(new Date(2026, 9, 31, hour, 15));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // 此用例验证同一分组的虚拟化和折叠，正午锚点保证倒序 2000 秒不会跨入昨天。
    const taskTime = new Date(2026, 9, 31, 12).getTime();
    const tasks = Array.from({ length: 2_000 }, (_, index) => ({ id: String(index), projectId: "a", title: `任务 ${index}`, pinned: false, updatedAt: new Date(taskTime - index * 1000).toISOString() }));
    const screen = await render(<QueryClientProvider client={client}><div style={{ height: 320, display: "flex", flexDirection: "column" }}>
      <SidebarTaskTimeline labels={labels} queries={[{ queryKey: ["timeline-test"], queryFn: async () => tasks }]}
        renderTask={task => <a className="block h-8" href={`#task-${task.id}`}>{task.title}</a>} />
    </div></QueryClientProvider>);
    const first = screen.getByRole("link", { name: "任务 0", exact: true });
    await expect.element(first).toBeVisible();
    expect(screen.container.querySelectorAll("a").length).toBeLessThan(40);
    const firstElement = first.element() as HTMLAnchorElement;
    firstElement.focus();
    firstElement.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    const last = screen.getByRole("link", { name: "任务 1999", exact: true });
    await expect.element(last).toHaveFocus();
    (last.element() as HTMLAnchorElement).dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    await expect.element(first).toHaveFocus();
    await expect.poll(() => first.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(screen.getByTestId("sidebar-task-timeline").element().getBoundingClientRect().top + 32);
    expect(screen.container.querySelectorAll("a").length).toBeLessThan(40);
    const heading = screen.getByRole("button", { name: /今天/ });
    await expect.element(heading).toHaveTextContent("今天2000");
    (heading.element() as HTMLButtonElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(heading).toHaveAttribute("aria-expanded", "false");
    await expect.element(heading).toHaveFocus();
    expect(screen.container.querySelectorAll("a").length).toBe(0);
    await heading.click();
    await expect.element(first).toBeVisible();
    expect(screen.container.querySelectorAll("a").length).toBeLessThan(40);
    client.clear();
  });

  it("保留其他项目的成功结果，失败可重试且不误报空目录", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const load = vi.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValue([]);
    const screen = await render(<QueryClientProvider client={client}>
      <SidebarTaskTimeline labels={labels} queries={[
        { queryKey: ["ok"], queryFn: async () => [{ id: "a", projectId: "a", title: "成功任务", pinned: false, updatedAt: new Date().toISOString() }] },
        { queryKey: ["failed"], queryFn: load },
      ]} renderTask={task => <a href={`#${task.id}`}>{task.title}</a>} />
    </QueryClientProvider>);
    await expect.element(screen.getByRole("alert")).toHaveTextContent("加载失败");
    await expect.element(screen.getByRole("link", { name: "成功任务" })).toBeVisible();
    expect(screen.getByText("暂无任务").query()).toBeNull();
    await screen.getByRole("button", { name: "重试" }).click();
    await expect.poll(() => load.mock.calls.length).toBe(2);
    await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
    client.clear();
  });
});
