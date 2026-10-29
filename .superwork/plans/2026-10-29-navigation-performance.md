# 消息目录性能修复

- 根因：父时间线在目录组件挂载门控之前按结构 revision 遍历全部条目；滚动处理每帧查询全部锚点并顺序读取布局；桌面独立实现全量 Tooltip。
- 目标：关闭时不调用目录索引工厂；两端共享虚拟目录；滚动复用锚点列表并二分读取实时位置，避免动态布局导致缓存坐标失效。
- 回归：双端关闭/开启/关闭切换、长目录挂载数量、滚动读取上界、动态锚点与布局位移、原有预览跳转。
- 执行：superwork-debugging → superwork-tdd → superwork-check；执行者 codex-navigation-20261029，公告 navigation-performance-20261029。
- 实现：父组件改为稳定索引工厂，启用后 memo 求值；两端注入翻译复用共享虚拟目录；固定行高避免逐项测量与观察；锚点节点缓存按结构变化失效，滚动只二分读取实时布局，并合并同帧通知。
- RED：原浏览器用例无法接收延迟索引工厂；4096 锚点滚动断言因重新 querySelectorAll 失败（Chromium/WebKit）。
- GREEN：`pnpm --dir desktop test:browser task-timeline-navigation.browser.test.tsx src/features/settings/components/conversation-display-preferences.browser.test.tsx`，4 文件、16 用例通过；同时驱动 Web/桌面入口，覆盖关闭零调用、可见挂载数小于 100、末项预览跳转、滚动布局读取少于 40、内容 Resize 与锚点增删。
- 根单元：`pnpm test`，662 文件通过、6 跳过，3805 用例通过、28 跳过；桌面 `pnpm --dir desktop test:run`，166 文件、673 用例通过。
- 性能：`pnpm test:performance`，9 文件、17 用例通过。
- 端到端：`pnpm exec playwright test tests/e2e/app-shell-message-navigation.spec.ts --workers=2`，Chromium/Firefox/WebKit 共 3 用例通过，含开关持久化、跳转及界面布局。
- 静态：两端 typecheck、两端 lint、lint:architecture、变更文件 Prettier、git diff --check 与桌面 source:lines 均通过。根 build 与桌面 build（含类型检查）通过。
- 预算：Web initial 350.60 KiB / 360、workbench 506.38 KiB / 520；桌面现代构建全部场景预算通过；package:check 通过。
- 简化复核：no-change；重复渲染已收敛到共享 UI，无额外重构。规范 update：在 frontend-core/shared/index.md 消息显示偏好处记录按需索引、虚拟挂载、二分读取和动态布局回归要求，避免覆盖其他任务声明的 UI 索引。
- 范围：macOS 本地验证前端与浏览器；未修改原生 Rust、服务端或协议，因此未运行 Rust 全套与原生 Windows/Ubuntu WebView。端到端及浏览器验证按消息目录范围运行。
- 最终优化：MutationObserver 只在锚点结构变化时请求测量，普通正文交给内容 ResizeObserver；增量未改变尺寸时布局读取为零。回归先在双端 Chromium/WebKit 复现 13 次读取，再收紧过滤并通过同一测试；WebKit 初始尺寸通知显式等待结束后才开始计数。
- 证据复用：全量单测和通用性能套件运行于最后一次观察器过滤调整前；这些 Node/SSR 用例不执行该浏览器 Effect，输入与被测行为等价，复用其结果。调整后重新执行两端构建/类型、两端 lint、架构检查、16 项浏览器回归及消息目录端到端/预算检查。
- Legacy 构建：最终版本再次构建通过；最终三浏览器端到端 3 项、Web/桌面预算及包验证通过。
