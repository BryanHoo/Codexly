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
- [ ] 执行根 `pnpm typecheck`、`pnpm test`、`pnpm lint:architecture`；工作流变化运行 `pnpm test:e2e`。构建后运行 `pnpm bundle:check`，性能变化补充 `pnpm test:performance` 或浏览器性能套件。

Web 包没有独立 `test` 脚本；测试入口在根 `package.json`，不要生成 `pnpm --filter @codexly/web test`。

## 诊断导出

- “设置 → 关于”的诊断导出不依赖版本检查成功；导出期间禁止重复执行，失败后允许重试。Web 与移动浏览器直接下载一个整合 ZIP，无需勾选；`application.json` 包含版本、浏览器异常和服务端快照，原生可用时纳入 `codex/diagnostics.zip`，收集状态写入 `manifest.json`。
- 复用 Client 准备接口和受控下载地址，ZIP 正文由浏览器直接下载，不读入 Blob；不把宿主路径暴露给浏览器。旧运行时或原生故障保留应用诊断，并明确标注原生不可用。
- 异常监听复用 `packages/frontend-core/src/application-diagnostics.ts`；Web 只保留当前页面最近 100 条脱敏异常，单条错误消息/堆栈分别限制为 512/2048 字符，不读取应用 context、页面 URL 或浏览器存储。桌面继续通过原生适配器录制与导出。
- 验证入口：`pnpm exec playwright test tests/e2e/app-shell-diagnostics.spec.ts`，覆盖 Chromium / Firefox / WebKit 的宽窄屏下载，以及版本失败、导出失败重试和执行互斥。
