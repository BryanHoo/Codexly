# Web 与移动浏览器前端

## 位置与职责

`apps/web/src/app` 负责应用装配，`features` 承载工作台和设置功能，`shared` 保留端内组合，`i18n` 维护文案。入口为 `apps/web/src/main.tsx`、`App.tsx`。

## 契约与检查项

- [ ] 经 `@codexly/client` 访问 HTTP / WebSocket；不得直接导入 Server、Core 或 Provider。
- [ ] 关于页的显式版本检查通过 `GET /v1/app-info?refresh=true` 绕过客户端和服务端版本缓存，普通读取保留缓存与在途合并；更新进度只在安装期间轮询。回归入口为 `app-update-query-options.test.ts` 与 `app-shell-settings-connection.spec.ts`。
- [ ] 检查更新入口在发现新版本前后保持固定位置，禁止因状态提示或安装按钮出现而让连续点击原位置触发安装。`app-shell-update-check.spec.ts` 使用真实坐标覆盖宽窄屏及三种浏览器。
- [ ] 共用状态推导与组件优先使用 Frontend Core / UI；平台回调与翻译由本端传入。参考 [复用边界](../../guides/code-reuse-thinking-guide.md)。
- [ ] 移动浏览器保留窄屏导航、触控和中栏文档工作区；核对 [文档工作区](../../../../docs/document-workspace.md) 与 [会话性能](../../../../docs/conversation-performance.md)。
- [ ] 历史和重型组件按需加载，流式消息使用共享增量渲染，避免逐 token 的全局状态重建。
- [ ] 打开全局设置时，与桌面统一使用 React `Activity` 隐藏整个工作台（含分屏），暂停界面订阅、快捷键等副作用，保留组件状态、DOM 和滚动位置；运行时事件接收及设置页留在边界外，禁止只用 `hidden` / `inert` 隐藏。返回时恢复订阅并读取最新输出。浏览器回归复用桌面套件的 `web-workbench-settings-activity.browser.test.tsx`，覆盖 Chromium / WebKit、宽窄屏、连续切换与后台增量输出；桌面原有入口为 `workbench-settings-navigation.browser.test.tsx`。
- [ ] 执行根 `pnpm typecheck`、`pnpm test`、`pnpm lint:architecture`；工作流变化运行 `pnpm test:e2e`。构建后运行 `pnpm bundle:check`，性能变化补充 `pnpm test:performance` 或浏览器性能套件。

Web 包没有独立 `test` 脚本；测试入口在根 `package.json`，不要生成 `pnpm --filter @codexly/web test`。

## 正文来源引用

- 来源卡片仅用于助手消息；用户消息中的裸 URL 与 Markdown 网页链接保留普通链接、原标签和目标地址，直接沿用 Web 新窗口或桌面系统浏览器导航。通过共享 Message 角色上下文区分，不能依据链接内容或文件引用开关推断角色；窄屏触屏与桌面点击均不先展开来源卡片。两端 `message-response-inline-citations`、桌面 `inline-citation.browser.test.tsx` 和 Web `app-shell-inline-citation.spec.ts` 覆盖此边界。
- HTTP(S) Markdown 来源链接复用 `@codexly/ui/agent/inline-citation` 的 HoverCard 与 Button 组合；保留原标签作为来源标题，缺失时回退域名。图片链接、本地文件、指令与非 HTTP(S) 地址继续使用原有语义。不为展示预览抓取网页，也不逐 Token 扫描全文；沿用共享增量分块树。
- 来源支持悬停、触屏点击及键盘操作，打开动作保留真实链接的 `noopener noreferrer` 与新窗口提示；卡片关闭不抢走输入框焦点。回归入口为 `message-response-inline-citations.test.tsx` 与 `app-shell-inline-citation.spec.ts`，覆盖 Chromium / Firefox / WebKit、真实触屏、长 URL 和流式节点身份。

## 子代理详情

- 共用 `packages/ui/src/agent/subagent.tsx`。任务提示词只展示一次，嵌套回合中的相同初始用户消息不重复渲染；省略历史标记不影响识别，后续追问、不同正文及附件保留。
- 操作详情弹窗最高 `min(80dvh, 48rem)`，标题固定，正文承担唯一纵向滚动。子代理详情打开后及输出增长时跟随底部；用户上滚或接管阅读后暂停，手动回到底部恢复，不能带动外层会话。关闭卸载观察器和重型内容。
- 回归入口为 `tests/e2e/app-shell-subagent-trace.spec.ts`（三浏览器、宽窄屏去重与高度），共享滚动交互由桌面 `subagent.browser.test.tsx` 验证。
- 右栏上下文与时间线共用 `OperationDetailsDialogContent`；内嵌和独立子线程都使用结构化 Subagent 内容和 50 条执行窗口，不切换到另一套聊天时间线。独立线程保留模型、初始任务、回合/过程历史分页；初始任务移到顶部后，只有任务摘要的回合仍须保留过程历史入口。条目增量只订阅目标 Store，禁止逐 Token 重建完整子线程快照。
- 右栏按钮在打开前显式聚焦，关闭后恢复该入口，兼容 WebKit 点击不聚焦按钮的行为。三浏览器入口回归覆盖两种来源、窄屏上下文面板和焦点恢复；内嵌模式不创建独立子任务读取。

## 诊断导出

- “设置 → 关于”的诊断导出不依赖版本检查成功；导出期间禁止重复执行，失败后允许重试。Web 与移动浏览器直接下载一个整合 ZIP，无需勾选；`application.json` 包含版本、浏览器异常和服务端快照，原生可用时纳入 `codex/diagnostics.zip`，收集状态写入 `manifest.json`。
- 复用 Client 准备接口和受控下载地址，ZIP 正文由浏览器直接下载，不读入 Blob；不把宿主路径暴露给浏览器。旧运行时或原生故障保留应用诊断，并明确标注原生不可用。
- 异常监听复用 `packages/frontend-core/src/application-diagnostics.ts`；Web 只保留当前页面最近 100 条脱敏异常，单条错误消息/堆栈分别限制为 512/2048 字符，不读取应用 context、页面 URL 或浏览器存储。桌面继续通过原生适配器录制与导出。
- 验证入口：`pnpm exec playwright test tests/e2e/app-shell-diagnostics.spec.ts`，覆盖 Chromium / Firefox / WebKit 的宽窄屏下载，以及版本失败、导出失败重试和执行互斥。
