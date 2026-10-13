# Web 前端

`apps/web/src/main.tsx` 启动 React，`app/router.tsx` 定义页面路由，`app/providers.tsx` 装配 Query、访问门禁、项目和草稿上下文。业务代码放 `features/`，通用 UI 放 `shared/components/`。

- 待发送提示使用共享 `frontend-core/prompt-delivery` 规则，在新用户消息或权威回合终态到达后清理；请求响应和返回任务时均检查当前 Store，不能等待已经错过的事件。
- 提交状态在请求开始与结束边界同步通知本地计时，不能依赖渲染副作用传递结束通知；React 合并提交状态时也必须清理占位。时间线收到已完成、失败或中断回合后立即撤销运行提示，缺少助手输出不能延长计时。

- HTTP 和事件调用通过 `@codexly/client`，共享类型通过 `@codexly/protocol`；不要从服务端或 Codex Provider 引入运行时代码。
- Mermaid 插件通过 `deferred-mermaid` 到实际图表渲染时才加载，普通 Markdown 不下载 Mermaid；并发图表共用加载，失败可重试，每个图表保留自身配置。英语基础文案独立拆包，首次挂载等待所选语言；中文启动不请求英语包。用插件回归、生产包预算及 Chrome CDP 验证中英文加载和真实 SVG 输出。
- 异步问题与项目待办由 Provider 级单个工作区变更订阅失效对应 Query；后台只标记失效，恢复可见及连接重建后校准。保留运行态或待处理问题的较快兜底和空闲低频兜底，禁止恢复固定高频空闲轮询；通知遇到在途读取时合并一次结束后的补读，不取消共享请求。用 `workbench-query-sync.test.ts`、`use-async-questions.test.tsx` 和 `project-todo-store.test.ts` 验证作用域隔离、后台停读和竞态。
- 任务实时状态集中在 `features/conversation/runtime/`；服务端查询交给 React Query，交互状态沿现有 feature 状态模块组织。
- Provider 的 `runtime_warning` 保留在同一事件会话的任务上下文中，右栏按条默认折叠展示，流式时间线不渲染；其他 `task.notice` 保持原有可见行为。
- 时间线按 `item.started` / `item.completed` 展示命令和工具耗时；文件编辑完成后不渲染“已编辑 N 个文件”任务行，回合运行中保留可打开的文件修改，终态仅由回复末尾汇总。思考项没有可靠起点，不估算耗时。
- 流式及静态消息中的文件引用右键提供复制绝对路径、打开所在文件夹和独立窗口打开；文件夹动作通过 Project 的 `file-manager` 能力打开宿主路径，web 端已有的下载入口保留。
- 侧栏创建 worktree 任务时，任务仍归属原 Project，Codex 线程保存 worktree `cwd`；任务启动失败时保留路径供重试，文件、Git 与外部终端以该路径为根。
- Project 行的新增任务、worktree 与项目菜单入口在 `hover: none` 设备上常显；鼠标端仍可仅在悬停或聚焦时显示。
- 收起的 Project 在未悬停、未聚焦时于最右侧显示任务状态，优先级为未查看完成、等待审批、运行；展开和移动触屏隐藏，悬停操作及布局保持原样。聚合完整活动记录，不依赖任务分页或搜索结果；两端共用 `frontend-core/project-task-status` 与 `ui/core/project-status-indicator`，浏览器回归覆盖 Chromium、WebKit、悬停和窄屏。
- 移动端工具栏保持单行，通过紧凑尺寸、间距和长标签截断适配窄屏，不统一强制 44px；发送按钮保持正方形。触屏操作不能依赖 hover，纯详情提示需支持点击查看。
- 仅覆盖式移动侧栏在任务导航后自动收起，重复选择当前任务或新建草稿也必须生效；预取和加载完成事件不能触发关闭。使用 `tests/e2e/app-shell-mobile-controls.spec.ts` 验证真实 touch 操作。
- 新建任务中栏的范围选择器同时包含“聊天”和所有 Project；切换仅导航到对应空草稿路由，首次提交才创建任务。
- 中栏底部分支弹窗只提供分支创建与切换；worktree 任务从左栏 Project 入口创建，不在分支弹窗中创建或切换 worktree。
- 即时发送通过校验后同步清空输入并展示本地用户消息和运行态；请求失败时仅在草稿仍为空时恢复原输入，真实用户 Item 到达后由它接管，不能重复显示。
- Skill、文件引用、模式命令及排队消息更新 Composer 时，同步替换草稿并定位光标；不要延迟到下一帧重设选区，以免覆盖用户紧接着的全选或输入。相关流程由 `tests/e2e/app-shell-composer-actions.spec.ts` 与 `tests/e2e/app-shell-runtime-queue.spec.ts` 验证。
- 可见文案同步更新 `i18n/locales/en/` 与 `zh-CN/`；组件改动检查相关 `*.test.tsx`。
- 根目录运行 `pnpm test`、`pnpm typecheck`；浏览器工作流运行 `pnpm test:e2e`，提交前运行 `pnpm check`。
- 调整 `vite.config.ts` 的首屏 `codeSplitting` 时，用 `pnpm start` 加载构建产物并检查浏览器运行时异常；构建成功不能验证循环导入的初始化顺序。

- 历史压缩入口在智能体设置中，Web 与桌面复用 `@codexly/ui/core/history-compression`。只由用户点击触发，区分提交中、已提交与失败；Web 文案明确压缩的是服务端历史。不要轮询完成状态或批量失效会话缓存。

- PDF 文件链接、附件和文件树共用 `core/pdf-preview` 原生预览；用 `navigator.pdfViewerEnabled` 检测能力，缺失时保留显式打开动作。附件点击后才加载，关闭后卸载；不引入 PDF.js 或 Base64 整文件传输。桌面只开放校验后的单文件 asset scope，独立预览窗口同时授权读取和打开命令。

- Git 能力仅由当前所选项目根目录决定，禁止扫描、聚合或选择子目录仓库。非 Git 项目隐藏右栏 Git 提示、重试、变更、历史和 Composer 分支入口，并停止活动、元数据、窗口聚焦及挂载自动刷新；显式项目刷新仍可重新探测。Web 与桌面共用 `frontend-core/project-git-availability` 判定，回归覆盖子仓库误判和残留错误状态。
- Web 的窗口焦点刷新由 Project Provider 集中安装，按项目及根目录去重；分屏只登记观察需求。worktree 的 10 秒轮询与活动任务的兜底轮询共用每根目录一个计时器，最后一个观察者退出后释放无活动任务的状态。焦点、任务切换和轮询复用 Query 在途读取，禁止取消后重新发送；文件变化、任务终态和手动刷新保留必要的串行补读。回归使用实际 TanStack Query 的五观察者覆盖请求次数、取消次数、根目录隔离与资源释放。

- 分屏最多同时展示 4 个聊天窗口，支持已创建任务和新建草稿；添加窗口保留任务菜单入口，并支持中栏空白处右键上下左右分屏和 `⌘/Ctrl + Alt + 方向键`；新窗口打开当前项目的独立草稿。共用 `frontend-core/split-workspace` 的身份与选择规则及 `ui/core/split-workspace` 的布局；按项目和任务组合设置稳定 key，增删其他窗口不得清空草稿或重挂时间线。每个窗口复用完整中栏，继续执行与 Fork 只更新所属窗口，迟到请求不得恢复已关闭窗口。
- 移动端不支持分屏：窄屏及无悬停的触摸设备隐藏入口，只展示活动任务；桌面尺寸恢复后保留其余窗口状态。验证四屏上限、重复添加、关闭首个窗口、独立发送和缩放往返时的输入保留。状态保留依据 [React 官方说明](https://react.dev/learn/preserving-and-resetting-state)，隐藏窗口使用 [Activity](https://react.dev/reference/react/Activity) 暂停副作用。

- Git 根仓库的“变更”标签在工作区清空后仍保留；有变更时主操作为“提交”，菜单提供“提交并推送”和“推送已有提交”，菜单不依赖提交信息可用性；空工作区隐藏提交输入与空文件列表，主操作为“推送”。结果区明确区分本地保存、推送成功和推送未完成，失败可单独重试，真实成功回执才显示“已推送”。操作共用队列和即时点击锁，干净工作区不额外读取 diff；两端共用 `ui/core/git-changes-actions`、操作文案与 Mutation 配置。回归覆盖部分提交后继续提交、Commit 后 Push、空工作区入口、菜单独立可用、推送中禁用与非 Git 项目隐藏。
