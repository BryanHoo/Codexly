# 桌面前端

## 位置与职责

`desktop/src/app` 与 `features` 承载应用和功能，`platform/tauri` 负责原生传输，`protocol` 维护桌面适配契约，`shared` 与 `i18n` 负责端内组合和翻译。原生边界见 [Rust 后端](../backend/index.md)。

## 契约与检查项

- [ ] 使用 Tauri 原生链路；将 IPC、终端、窗口与系统集成留在平台适配层，共用组件和纯逻辑复用 UI / Frontend Core。
- [ ] 状态栏图标显示开关默认开启，原生配置即时生效并跨重启保留；隐藏仅控制图标，不改变关闭窗口后最小化到托盘的行为。回归入口为 `tray-settings-field.browser.test.tsx` 与 Rust `tray_settings` 测试。
- [ ] 关于页的检查更新按钮必须保持固定位置，版本状态、检查中文案和安装入口变化不能让连续点击落到安装按钮；布局回归需加载真实样式，并按原坐标再次点击。验证入口为 `global-settings-about.browser.test.tsx`，覆盖窄窗口及 Chromium / WebKit。
- [ ] 共享组件变更同时检查 Web 调用者；桌面私有能力与 macOS Legacy 分支遵循 [能力参考](../../../../desktop/docs/codexly-capability-matrix.md)。
- [ ] 流式消息保持有界增量更新，文档 / 分屏工作区核对焦点、滚动、键盘和拖拽行为。参照 [文档工作区](../../../../docs/document-workspace.md)。
- [ ] 快捷键帮助区分全局命令与功能内按键，并标注编辑器、输入框和项目标题等生效场景；新增条目同步中英文，长列表须支持窗口内滚动。回归入口为 `workbench-shortcuts.browser.test.tsx`，同时验证共享帮助菜单随文字长度自适应。
- [ ] 源文件与测试文件遵守桌面 500 行限制，由 `source:lines` 检查。
- [ ] 自动化使用 `pnpm --dir desktop test:run`；布局与焦点使用 `pnpm --dir desktop test:browser`，覆盖 Chromium / WebKit。
- [ ] 输入区域从可写切换为锁定时，在布局阶段释放边界内部的焦点；不要依赖浏览器对 `disabled` / `inert` 的自动失焦，也不能移走其他分栏的焦点。回归入口为 `composer-ownership.browser.test.tsx`。
- [ ] 底栏通过 Portal 移出聊天裁剪区时，输入框使用专用双层阴影，保持既有 12px 留白和 36px 底栏；不要用过淡的控件阴影代替，也不要增加间距来避开裁剪。`composer-ownership.browser.test.tsx` 覆盖 Chromium / WebKit、明暗主题及单窗 / 分屏；测量普通阴影前须移除展开操作产生的编辑器焦点。
- [ ] 原生 WebView 测试及模拟运行时从根工作区已安装的 `@openai/codex/package.json` 读取版本，与运行时打包脚本共用来源，避免升级后留下独立硬编码预期。
- [ ] `pnpm --dir desktop check:web` 覆盖静态检查、类型、测试、Tauri 约束、现代 / Legacy 构建和包体预算；完整桌面门槛是 `pnpm --dir desktop check`。

开发入口见 [桌面开发](../../../../desktop/docs/development.md)。
