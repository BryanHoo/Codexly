# 共享 UI

`@codexly/ui` 存放 Web 与桌面端视觉和交互一致的 React 控件。各端现有组件路径可用薄导出维持调用点，但组件实现只保留在 `packages/ui/src/`。

- 基础控件从 `@codexly/ui/core/*` 导入；Agent 展示组件只在平台行为拆出后从 `@codexly/ui/agent/*` 导入。
- Tooltip 不因获得或恢复焦点自动打开；共享 Trigger 保留业务焦点回调，仅阻止 Radix 的焦点打开行为，鼠标悬停仍展示。承载正文的自定义备注提示需支持点击及键盘主动查看。
- Composer 权限与沙盒使用共享 `CompactSelector` 锚定下拉菜单；触发器与模型、思考量保持一致，支持窄屏标签截断和视口碰撞边界，不使用原生 select 弹层。
- 文件打开、下载、Markdown 链接、通知和翻译由调用方提供。公共包不引入 Tauri API、Web 客户端或应用内 feature 代码。
- 新建项目表单共用 `core/new-project-dialog.tsx`，父目录选择切换同一模态层并保留名称；目录创建与项目注册分开，注册失败只重试添加，同名目录须明确确认复用。Web 的文件系统操作面向服务器，须展示主机信息并验证移动端布局。
- 两端 `globals.css` 必须扫描 `packages/ui/src`，以保留公共组件中的 Tailwind 类。
- 验证边界使用 `apps/web/src/shared/components/shared-ui-boundary.test.ts`、根目录 `pnpm lint:architecture`，并分别运行 Web 与桌面构建。
