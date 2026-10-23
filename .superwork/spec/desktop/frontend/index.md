# 桌面前端

## 位置与职责

`desktop/src/app` 与 `features` 承载应用和功能，`platform/tauri` 负责原生传输，`protocol` 维护桌面适配契约，`shared` 与 `i18n` 负责端内组合和翻译。原生边界见 [Rust 后端](../backend/index.md)。

## 契约与检查项

- [ ] 使用 Tauri 原生链路；将 IPC、终端、窗口与系统集成留在平台适配层，共用组件和纯逻辑复用 UI / Frontend Core。
- [ ] 共享组件变更同时检查 Web 调用者；桌面私有能力与 macOS Legacy 分支遵循 [能力参考](../../../../desktop/docs/codexly-capability-matrix.md)。
- [ ] 流式消息保持有界增量更新，文档 / 分屏工作区核对焦点、滚动、键盘和拖拽行为。参照 [文档工作区](../../../../docs/document-workspace.md)。
- [ ] 源文件与测试文件遵守桌面 500 行限制，由 `source:lines` 检查。
- [ ] 自动化使用 `pnpm --dir desktop test:run`；布局与焦点使用 `pnpm --dir desktop test:browser`，覆盖 Chromium / WebKit。
- [ ] `pnpm --dir desktop check:web` 覆盖静态检查、类型、测试、Tauri 约束、现代 / Legacy 构建和包体预算；完整桌面门槛是 `pnpm --dir desktop check`。

开发入口见 [桌面开发](../../../../desktop/docs/development.md)。
