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

## 共享加载占位

- 内容首载复用 `@codexly/ui/core/skeleton` 原语和 `core/loading-skeleton` 的列表、会话、设置、卡片、统计、工作台及代码轮廓；两端注入现有翻译，不新增加载请求或计时器。骨架颜色映射现有 `control-hover` 主题，不能直接使用项目未定义的上游 `accent` 令牌。
- 只在内容尚不可用时显示骨架；后台刷新、部分项目结果和已有会话快照保留内容，错误继续显示错误与重试，真实生成、下载和保存进度沿用原有反馈。
- 整个占位只提供一个本地化 `status` 和 `aria-busy`，装饰图形隐藏，不生成可聚焦控件；动画仅在 `motion-safe` 下执行。固定骨架数量，避免订阅查询或创建逐帧 React 状态。
- 回归入口：Web `app-shell-skeleton.spec.ts` 验证请求未完成与完成切换、窄屏和减少动态效果；桌面 `loading-skeleton.browser.test.tsx` 以真实样式验证 Chromium / WebKit、320px、明暗主题、可见颜色及焦点，不能把移动端已隐藏的桌面侧栏作为可见性测量对象。

## 共享 Tooltip

- 两端 Tooltip 统一复用 `packages/ui/src/core/tooltip.tsx`，底层使用 shadcn/ui Base UI 的 Provider、Trigger、Portal、Positioner、Popup 与 Arrow；根应用保留统一 Provider。现有 `asChild` 映射到 Base UI `render`，不得新增外层按钮或丢失事件、ref 和可访问名称。
- 默认悬停延迟 350ms，相邻提示的快速切换窗口 150ms；已有 Root 的 `delayDuration` 通过局部上下文传给 Trigger，不新建独立 Provider，以保留相邻提示分组。新增调用可直接使用 `render` 和 Provider 的 `delay`、`timeout`。
- 提示是辅助说明，图标按钮仍须独立提供可访问名称；重要说明与交互内容使用正文或 Popover。键盘可见焦点打开提示，Escape 关闭，鼠标关闭菜单后的焦点恢复与触屏点击不得留下提示。禁用按钮需要提示时，用 span 包裹按钮作为 Trigger。
- Popup 可悬停，Portal 避免滚动容器裁剪，Positioner 保持 8px 视口留白并允许翻转；长路径可换行，箭头继承 Popup 背景，动效遵循减少动态效果设置。Base UI 新依赖须纳入桌面浏览器测试的预打包列表，避免测试中途重新优化、重载及重复加载 React。
- 回归入口为 `desktop/src/shared/components/core/tooltip.browser.test.tsx`（两端入口、Chromium/WebKit、事件/ref、禁用按钮包装、菜单组合、延迟分组和宽窄屏）与 `tests/e2e/app-shell-tooltip.spec.ts`（三浏览器、明暗主题、键盘、减少动态效果及真实触屏）。
- Base UI 迁移后的 Web 首屏 gzip 预算为 360 KiB，工作台就绪为 520 KiB，最大异步依赖组仍为 640 KiB；以 `tools/verify-web-bundle.mjs` 的实际静态依赖闭包测量，预算变更不替代交互和渲染性能验证。
- 桌面以 `desktop/performance-budget.json` 校验未压缩的首屏及完整场景闭包：首屏 475,000 字节；workspace 1,820,000、markdown 2,320,000、cppHighlight 2,900,000 字节；textEditor 2,150,000、taskWindow 550,000 字节。两端统计口径不同，不能直接比较 gzip 与原始字节预算。

## 共享 Dialog 与 Drawer

- 2026-10-29 用户要求视觉一并采用官方组件设计：关闭控件独立定位于浮层右上角，固定 32×32px、图标 16px。此规则替代旧共享 UI 索引中“标题等高、14px 图标”的旧要求；禁止再用 `w-[1em]`、`size="embedded"` 或继承标题字号压缩关闭入口。长标题留出右侧空间，不能用标题高度决定按钮形状。
- 普通模态窗口统一通过 `packages/ui/src/core/dialog.tsx` 使用 shadcn Base UI Dialog；侧边抽屉通过 `drawer.tsx` 使用 Base UI Drawer 的 Portal、Viewport、Popup、Content。`Sheet` 仅保留兼容导出，新增调用使用 Drawer，方向由 Root 的 `swipeDirection` 指定。
- Root / Trigger 同步加载；Portal / Popup 与 Drawer 手势层分别由 `dialog-surface.tsx`、`drawer-surface.tsx` 在首次打开时动态加载，关闭状态不得请求这两个模块。首次加载后保留轻量边界，让 Base UI 完成退出动画并卸载 DOM，重开复用模块缓存。
- 既有 `asChild` 映射官方 `render`，焦点回调映射 `initialFocus` / `finalFocus`，保留编辑器和分屏的手动恢复。关闭拦截统一在 Root 转为 `eventDetails.cancel()`，提交期间同时阻止 Escape、遮罩和关闭按钮；未保存草稿保留原有确认流程。
- Drawer.Content 保护正文的鼠标选择，拖动手柄应位于 Content 外部；移动侧栏启用手柄，触控正文滚动与侧向滑动由 Base UI 仲裁。动效只使用合成属性并遵循减少动态效果设置，关闭后 Portal 卸载。
- 两端入口统一导出共享组件，并同步背景图片的浮层材质选择器 `drawer-popup`。浏览器测试预打包 `@base-ui/react/dialog` 与 `@base-ui/react/drawer`，防止测试中途重新打包造成重复 React。
- 回归入口为 `dialog-close.browser.test.tsx`、`drawer.browser.test.tsx`、桌面全局搜索/新建项目/已归档任务/子代理输出/常用提示词，以及 Web `app-shell-new-project.spec.ts`、`app-shell-saved-prompts.spec.ts`。包体预算按本次用户指令调整，仍执行交互与性能检查。
- `tests/e2e/app-shell-modal-lazy.spec.ts` 用真实生产请求验证未打开不加载、首次打开加载及重开复用缓存；生产 manifest 验证两个 surface 不进入首屏或工作台静态闭包。

## 共享 Toast

- Web、移动浏览器和桌面应用通知统一使用 `packages/ui/src/core/toaster.tsx` 的 shadcn Base UI Toast；`notifications.tsx` 只持有单个官方 manager 并提供业务语义快捷方法，也直接暴露 `add`、`update`、`close`、`promise`。禁止恢复自制通知 store、计时器或顶部 message 卡片样式。
- 应用根挂载一个 Toaster，文案由宿主注入；Provider、Portal、Viewport、Root、Content、Title、Description、Action 和 Close 共同管理堆叠、滑动、暂停计时和焦点恢复。使用官方右下角堆叠与悬停展开，窄屏左右各保留至少 16px 并适配安全区域，支持减少动态效果。
- 设置保存仍使用稳定 `settings-save` ID 原位更新；重试关闭旧通知后交还原业务动作，失败离页保护仍能重新展示。正文保持自然高度，不让 Content 的百分比高度与卡片高度动画形成 ResizeObserver 反馈；长正文独立滚动且保留操作入口。
- 关闭按钮由 Base UI 在通知展开或键盘聚焦时暴露给辅助技术；测试先悬停或用 F6 定位通知区域，再操作按钮。Toast 原语使用 dialog 语义，通知测试定位 `data-slot="toast"` 或标题文字，不能继续依赖旧 status/alert 容器或渲染容器内查询，因为 Portal 挂载到 body。
- 回归入口为桌面 `toaster.browser.test.tsx`（Chromium / WebKit、堆叠、宽窄屏、长文、同 ID 更新、重试及设置保存）与 Web `app-shell-toast.spec.ts`（三浏览器、明暗主题、减少动态效果、键盘关闭及焦点恢复）；测试依赖预打包包含 `@base-ui/react/toast`。
