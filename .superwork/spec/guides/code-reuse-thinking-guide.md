# Codexly 代码复用边界

## 代码归属

- `packages/protocol` 维护公开 Schema、事件与共享 SQL 契约，不依赖其他内部包。
- `packages/core` 维护领域规则、Provider 与 Repository 端口，只依赖 Protocol。
- `packages/frontend-core` 维护与平台无关的视图模型、增量处理和状态推导。
- `packages/ui` 维护两端共用 React 组件，复用 Frontend Core，通过 props 接收平台行为和文案。
- `packages/client` 维护 Web HTTP/WebSocket 传输；桌面传输留在 `desktop/src/platform/tauri`，避免为复用界面绕行 Web 服务。
- Provider 实现 Core 端口，Server 负责交付装配；依赖边界以根 `dependency-cruiser.config.cjs` 与各包 README 为准。

## 可复用示例

`apps/web/src/shared/components/agent/code-block.tsx` 与 `desktop/src/shared/components/agent/code-block.tsx` 都包装 `@codexly/ui/agent/code-block`，各自注入翻译，桌面再注入 Legacy 主题。跨端渲染优化应优先修改 `packages/ui/src/agent/code-block.tsx`。

## 检查项

- [ ] 搜索共享包与两端调用者，确认现有导出和测试覆盖范围。
- [ ] 将共用纯逻辑放入 Frontend Core、共用组件放入 UI，保留文件系统、IPC、网络等平台实现。
- [ ] 共享包不得反向导入 `apps/web`、`desktop`、根 CLI 或具体交付实现。
- [ ] 运行根 `pnpm lint:architecture`、`pnpm typecheck` 和相关测试；共享 UI 同时核对 Web 与桌面浏览器用例。

## 共享 Tooltip

- 两端 Tooltip 统一复用 `packages/ui/src/core/tooltip.tsx`，底层使用 shadcn/ui Base UI 的 Provider、Trigger、Portal、Positioner、Popup 与 Arrow；根应用保留统一 Provider。现有 `asChild` 映射到 Base UI `render`，不得新增外层按钮或丢失事件、ref 和可访问名称。
- 默认悬停延迟 350ms，相邻提示的快速切换窗口 150ms；已有 Root 的 `delayDuration` 通过局部上下文传给 Trigger，不新建独立 Provider，以保留相邻提示分组。新增调用可直接使用 `render` 和 Provider 的 `delay`、`timeout`。
- 提示是辅助说明，图标按钮仍须独立提供可访问名称；重要说明与交互内容使用正文或 Popover。键盘可见焦点打开提示，Escape 关闭，鼠标关闭菜单后的焦点恢复与触屏点击不得留下提示。禁用按钮需要提示时，用 span 包裹按钮作为 Trigger。
- Popup 可悬停，Portal 避免滚动容器裁剪，Positioner 保持 8px 视口留白并允许翻转；长路径可换行，箭头继承 Popup 背景，动效遵循减少动态效果设置。Base UI 新依赖须纳入桌面浏览器测试的预打包列表，避免测试中途重新优化、重载及重复加载 React。
- 回归入口为 `desktop/src/shared/components/core/tooltip.browser.test.tsx`（两端入口、Chromium/WebKit、事件/ref、禁用按钮包装、菜单组合、延迟分组和宽窄屏）与 `tests/e2e/app-shell-tooltip.spec.ts`（三浏览器、明暗主题、键盘、减少动态效果及真实触屏）。
- Base UI 迁移后的 Web 首屏 gzip 预算为 360 KiB，工作台就绪仍为 500 KiB，最大异步依赖组仍为 640 KiB；以 `tools/verify-web-bundle.mjs` 的实际静态依赖闭包测量，预算变更不替代交互和渲染性能验证。
- 桌面以 `desktop/performance-budget.json` 校验未压缩的完整场景闭包：workspace 1,780,000、markdown 2,280,000、cppHighlight 2,850,000 字节；textEditor 2,050,000、taskWindow 550,000 字节。两端统计口径不同，不能直接比较 gzip 与原始字节预算。
