import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { McpServerSection } from "./workbench-inspector-sections.js";

function renderMcp(overrides: Partial<Parameters<typeof McpServerSection>[0]> = {}) {
  return renderToStaticMarkup(
    <TooltipProvider>
      <McpServerSection
        canRetry
        isRefreshing={false}
        isRetrying={false}
        onRetry={() => undefined}
        servers={[{ name: "docs", displayName: "Docs", status: "connected", toolCount: 12 }]}
        {...overrides}
      />
    </TooltipProvider>,
  );
}

describe("MCP 上下文面板", () => {
  it("Claude 快照与 Codex 使用同一紧凑工具栏，次要操作按需展开", () => {
    for (const statusSource of [undefined, "cached", "live"] as const) {
      const markup = renderMcp({ ...(statusSource ? { statusSource } : {}) });
      expect(markup).toContain('aria-label="刷新状态"');
      // 无快照语义的旧引擎仍只提供原有刷新，不暴露不支持的高级操作。
      expect(markup.includes('aria-label="更多 MCP 操作"')).toBe(Boolean(statusSource));
      expect(markup).not.toContain(">重连失败服务</");
      expect(markup).not.toContain(">重新加载配置</");
    }
  });

  it("空快照说明未配置状态，不展示底部快照信息", () => {
    const markup = renderMcp({ servers: [], statusSource: "cached", observedAt: null });
    expect(markup).toContain("暂无 MCP 服务");
    expect(markup).not.toContain("缓存状态");
    expect(markup).not.toContain("观测时间未知");
    expect(markup).not.toContain("<time");
    expect(renderMcp({ servers: [] })).toBe("");
  });

  it("刷新期间提供忙碌语义并禁止重复操作", () => {
    const markup = renderMcp({ isRefreshing: true, statusSource: "live" });
    expect(markup).toContain('aria-busy="true"');
    expect(markup.match(/disabled=""/gu)).toHaveLength(2);
  });

  it("缓存与实时快照均不渲染状态和观测时间，保持两种引擎的列表布局一致", () => {
    for (const statusSource of ["cached", "live"] as const) {
      const markup = renderMcp({ statusSource, observedAt: "2026-10-20T02:30:00Z" });
      expect(markup).not.toContain("缓存状态");
      expect(markup).not.toContain("最新观测");
      expect(markup).not.toContain("<time");
    }
  });

  it("只读面板不提供服务操作", () => {
    const markup = renderMcp({ canRetry: false, statusSource: "cached" });
    expect(markup).not.toContain('aria-label="刷新状态"');
    expect(markup).not.toContain('aria-label="更多 MCP 操作"');
  });
});
