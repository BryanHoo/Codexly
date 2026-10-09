# 共享 UI

`@codexly/ui` 存放 Web 与桌面端视觉和交互一致的 React 控件。各端现有组件路径可用薄导出维持调用点，但组件实现只保留在 `packages/ui/src/`。

- 基础控件从 `@codexly/ui/core/*` 导入；Agent 展示组件只在平台行为拆出后从 `@codexly/ui/agent/*` 导入。
- Tooltip 不因获得或恢复焦点自动打开；共享 Trigger 保留业务焦点回调，仅阻止 Radix 的焦点打开行为，鼠标悬停仍展示。承载正文的自定义备注提示需支持点击及键盘主动查看。
- Composer 权限与沙盒使用共享 `CompactSelector` 锚定下拉菜单；触发器与模型、思考量保持一致，支持窄屏标签截断和视口碰撞边界，不使用原生 select 弹层。
- 文件打开、下载、Markdown 链接、通知和翻译由调用方提供。公共包不引入 Tauri API、Web 客户端或应用内 feature 代码。
- 新建项目表单共用 `core/new-project-dialog.tsx`，父目录选择切换同一模态层并保留名称；目录创建与项目注册分开，注册失败只重试添加，同名目录须明确确认复用。Web 的文件系统操作面向服务器，须展示主机信息并验证移动端布局。
- 两端 `globals.css` 必须扫描 `packages/ui/src`，以保留公共组件中的 Tailwind 类。
- 消息附件、项目图片和壁纸原图共用 `core/image-preview`，翻译由各端传入；手势引擎仅在预览挂载时加载。预览支持容器内缩放、拖动、双指手势和复位，切换资源或容器尺寸变化时恢复适配；捏合后的触摸拖动不得误判为双击。用 `desktop/src/shared/components/core/image-preview.browser.test.tsx` 验证 Chromium、WebKit 和移动端窄屏。
- 流式 Markdown 的树形渲染与文本揭示动画放在 `agent/streaming-markdown`，两端引入其共享样式；稳定前缀不能因追加而重挂，图表和自定义插件不得被普通代码快路径替代。
- 验证边界使用 `apps/web/src/shared/components/shared-ui-boundary.test.ts`、根目录 `pnpm lint:architecture`，并分别运行 Web 与桌面构建。

- PDF 文件链接、附件和文件树共用 `core/pdf-preview` 原生预览；用 `navigator.pdfViewerEnabled` 检测能力，缺失时保留显式打开动作。附件点击后才加载，关闭后卸载；不引入 PDF.js 或 Base64 整文件传输。桌面只开放校验后的单文件 asset scope，独立预览窗口同时授权读取和打开命令。

- 分屏输入区域共用 `core/split-composer`，新建任务的草稿窗口默认展开，已有任务默认收起，各窗口可独立手动切换；恢复单窗口或移动端时自动展示。分支、项目路径和上下文底栏始终可见，展开/收起按钮放在该底栏。保留编辑器 DOM、草稿、附件和队列，隐藏区不可聚焦；待回答问题及可用的停止入口不得被收起遮挡。文件引用、底栏草稿恢复应唤起输入框；无底栏的定时任务编辑器不参与收起。

- 左右栏属于工作区外层，只有中栏参与分屏。右栏共用 `core/split-inspector` 的开关及挂载位置，活动窗口通过 [React Portal](https://react.dev/reference/react-dom/createPortal) 提供右栏内容并保留其任务回调；不得为右栏另建任务订阅。非活动窗口停用右栏专属查询，分屏切换时保留各自文档/标签及全局面板宽度。左栏高亮和 `aria-current` 以活动窗口身份为准，不能让未改变的 URL 再激活原任务。
- 用户消息快捷目录通过 `core/timeline-navigation-host` 定位到所属窗口，采用窗口内绝对定位及相对高度；禁止使用全局首个 `.workbench-shell` 或视口固定定位。回归检查四屏目录互不重叠、右栏切换内容、侧栏唯一激活项、收起状态及草稿保留。
- 分屏时左栏普通任务点击由工作区接管：目标未打开则原位替换聚焦窗口，已打开则只切换焦点，禁止退出分屏或删除原窗口；其余窗口的顺序、草稿和挂载身份保持稳定。单窗口、移动端及修饰键打开链接继续使用原有导航行为。回归覆盖四屏满额替换、重复选择及跨项目任务身份。
- 分屏新建任务同样替换聚焦窗口，包括全局入口、项目/聊天分组加号、桌面快捷键和 worktree 创建。空聊天使用独立草稿身份和 Composer 存储范围，不能伪造 taskId 或提前创建服务端任务；范围切换及首次发送后只替换所属窗口，旧草稿的迟到结果不得覆盖新草稿。回归覆盖同项目多草稿、四屏新建、草稿转任务和关闭后返回结果。
