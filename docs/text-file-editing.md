# 文本文件编辑

## 方案与适用范围

采用 **CodeMirror 6**，由 `packages/ui` 提供共享编辑器；Web（含移动浏览器）和桌面使用同一套交互，分别通过现有 HTTP / Tauri 原生边界访问文件。2026-10-30 的手动保存要求替代此前的失焦自动保存方案。

| 方案                            | 取舍                                                                 |
| ------------------------------- | -------------------------------------------------------------------- |
| CodeMirror 6                    | 模块化、可视区域渲染、增量文本树和按需语言扩展，适合多端低占用目标。 |
| Monaco                          | IDE 能力丰富，但官方明确不支持移动浏览器；不引入第二套编辑内核。     |
| 自研 textarea / contenteditable | 需自行维护撤销、选择、查找与输入法，维护成本高。                     |

支持已授权项目/worktree 内不超过 **2 MiB** 的 UTF-8 文本，包括 Markdown、TXT、常见代码、JSON、YAML、XML、SQL 与空文件；保留 LF/CRLF、UTF-8 BOM。混合换行、孤立 CR、无效 UTF-8、二进制、Office、PDF、图片等继续只读预览。符号链接、`.git` 和项目外路径不可写。没有项目根目录的外部引用保持只读。

JS/TS/JSX/TSX、JSON、Markdown、Python、Rust、HTML、CSS、YAML、SQL、XML 按需加载语法；其他文本仍可编辑。不提供 LSP、自动格式化、编码转换或富文本编辑。

## 查找与编辑

- 工具栏左侧集中撤销、重做、查找与换行，右侧固定显示文字“保存”主按钮；未修改或保存中禁用。图标命令统一使用共享 Tooltip，悬停和键盘焦点提供名称与适用的快捷键，禁用按钮也能查看说明。
- 查找替换采用共享 Button、ButtonGroup、InputGroup 与 Tooltip。宽面板两行输入对齐，匹配选项嵌入查找输入组，导航与替换操作各自分组；面板宽度不超过 560px 时，输入各占一行，导航与替换操作合为第三行。关闭图标在右上角独立占位，点击区域 **32×32px**。响应依据面板实际宽度，覆盖分屏与移动浏览器；旧版 WebView 使用按断点更新的尺寸观察回退。
- 面板通过 CodeMirror 官方 `createPanel`、搜索状态和命令实现，不维护另一份正文。输入即时更新查询，非法正则标记无效并禁用操作；输入法确认不执行查找或替换。
- 提供撤销重做、自动换行、代码折叠、括号补全、Tab 缩进与行号跳转。查找替换可撤销，Escape 关闭查找后回到编辑器；Escape 后 Tab 可离开编辑器。
- `Ctrl+F` / `⌘F` 打开查找，`Alt+Z` 切换换行。`Ctrl+S` / `⌘S` 在正文、查找替换输入和工具栏内均保存当前文件，不触发浏览器另存网页。
- 深浅主题复用项目语义色，语法颜色由 CSS 变量切换，不重建编辑状态；底栏显示保存状态、行列、编码、换行和语言。

## 手动保存与标签状态

- **不自动保存**。输入、失焦、切换标签、切换窗口、隐藏页面及卸载视图都不写盘。保存只由保存按钮、快捷键或关闭确认中的保存动作触发。
- 编辑后文件标签名称旁显示圆点；后台标签和聊天切换后仍保留。保存失败或冲突不会清除圆点，保存回执未到达前保持标记；撤销回已保存正文可恢复干净状态。
- 每次保存只提交按下保存时的不可变快照。保存期间继续输入的内容保持未保存，不能自动追写；回执只确认已提交内容。重复点击/快捷键共享在途保存，完成后可再次显式保存。
- 标签状态只订阅脏/保存中的标量变化。正文不进入 React、标签布局或全局 Query 缓存，也不逐键序列化全文。
- 普通大小的未保存文件切换后保留撤销、选择和滚动。会话估算保留量超过 4 MiB 时，后台草稿压缩历史和解析状态，仍保留正文、选择、换行及保存基线。

## 关闭与离开

- 切换文件或返回聊天保留草稿，不弹关闭确认。Markdown 源码/预览切换和查看差异不保存，预览按需读取当前草稿。
- 同项目切换任务返回聊天并保留全部文件标签、固定状态及草稿，无保存请求、无关闭确认；文件继续使用打开时的根目录。跨项目切换任务关闭该窗口的文件标签，有未保存更改时统一提示切换前保存，覆盖后台文件；取消或保存失败留在原任务，确认保存成功或不保存后才切换。规则由共享工作区统一处理，普通路由、分屏及移动端一致，详见 [文档工作区](document-workspace.md)。
- 关闭任何未保存文件（包括后台标签）显示 **保存 / 不保存 / 取消**。取消保持标签和草稿；保存成功且无新输入才关闭；不保存丢弃草稿并清空其撤销历史。
- 批量关闭汇总全部目标脏文件，包含后台标签并尊重固定项。全部处理完成才移除整批标签；某个文件保存失败则保留标签并切到失败文件。此前已成功的保存不会回滚。
- 保存失败保留常驻原因和重试入口；关闭保存期间有新输入时保持文件打开。新导航、工作目录变化或卸载会使旧关闭请求失效，迟到回执不能关闭新的文件。
- 页面内路由和独立文件窗口关闭使用共享确认；浏览器刷新/退出使用原生未保存提示，后台草稿也参与退出保护。桌面主窗口继续由原生统一退出确认保护。
- 草稿仅在当前窗口内存保存，**不是 VS Code Hot Exit 的跨重启备份**。强制退出、崩溃、刷新后放弃退出提示不能保证恢复。

## 磁盘冲突

显式保存收到 `TEXT_FILE_CONFLICT` 时自动打开“保存冲突”弹窗，展示磁盘与草稿差异，并提供：

1. **继续编辑**：关闭弹窗，保留草稿；可手动合并后再次比较/保存。
2. **使用磁盘版本**：二次确认后放弃草稿，载入已比较的磁盘快照；更新版本、换行及修订标记，清空撤销历史。
3. **用当前草稿保存**：二次确认后以已比较的磁盘版本为 `expectedVersion` 提交。比较后磁盘再次变化仍拒绝覆盖，保留草稿。

常驻提示仍提供再次比较入口。比较后草稿变化、保存进行中或文件身份不匹配时拒绝应用旧比较结果。读盘/模块加载失败可重试，关闭取消读取并销毁差异视图。差异扩展仅处理冲突/比较时加载，使用 `scanLimit=500`、`timeout=50ms`；复杂差异降低精度，不截断正文。

## 文件操作

项目树提供新建文件/目录、重命名和删除。两端复用弹窗及可移植名称校验；重命名默认只选主名，点文件/目录选择全名。提交失败保留名称和内联错误，删除默认聚焦取消。同步提交锁阻止重复操作；输入改变生成新幂等键，结果不明的相同输入重试复用原键。不改变既有磁盘删除语义。

## 数据与性能约束

共享契约仍为 `ProjectTextFile { path, content, version, revision? }` 和 `SaveProjectTextFileRequest { path, content, expectedVersion }`。保存只返回新版本与可选修订标记，不回传全文。

- HTTP：`GET/POST /v1/projects/:projectId/files/text`，查询参数携带 `rootPath`；元数据校验使用 `files/text/revision`。桌面使用 `read_project_text_file`、`save_project_text_file`、`read_project_text_file_revision`。
- 版本为原始 UTF-8 字节的 SHA-256。读写有界；保存复验版本和路径，写同目录临时文件并同步、原子替换。同文件保存串行，Rust 使用 `spawn_blocking`，Node 使用异步文件 I/O。
- 版本校验与替换并非操作系统级 CAS；不协作程序在最终复验与替换间仍有极短竞争窗口。
- 输入按最终 UTF-8 字节数校验（含 BOM、CRLF、中文、代理对），超限事务整笔拒绝，不破坏原正文、选择和撤销。剪贴板换行先规范为当前文件格式。
- 正文超过 **256 KiB** 时暂停解析，缩小后恢复；异步语言加载完成时复查当前大小。
- 每客户端最多 **16 个闲置会话、64 MiB 估算缓存**；页面共用 **16 个活动/未保存文件、32 MiB 正文预留**，每文件读取前预留完整 2 MiB。草稿不能因缓存淘汰而丢失；容量满的新文件回退只读。
- 标签注册表不复制正文，干净后台标签释放会话句柄及订阅，不能绕过缓存 LRU。只挂载当前文档的 `EditorView`，卸载销毁视图并保留有预算的状态。
- 在途读取合并；重新激活干净会话先检查修订标记，变化才读全文。未保存会话不被外部内容覆盖，保存仍执行 SHA-256 校验。无后台轮询、逐键网络请求或新增后台 Worker。

## 官方依据与验证入口

- [VS Code 基础编辑](https://code.visualstudio.com/docs/editing/codebasics.md)：默认手动保存、脏标签、查找替换与 Hot Exit 的边界。
- [VS Code 保存错误处理源码](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/files/browser/editors/textFileSaveErrorHandler.ts)：磁盘较新时的比较、覆盖与恢复动作。本项目继续使用条件保存。
- [CodeMirror 系统指南](https://codemirror.net/docs/guide/)、[官方扩展/API 示例](https://codemirror.net/docs/ref/)：可视区域渲染、搜索面板扩展、状态与视图生命周期。
- [shadcn/ui Input Group](https://ui.shadcn.com/docs/components/input-group)、[Tooltip](https://ui.shadcn.com/docs/components/tooltip)：输入与附加操作的组合、图标提示及禁用按钮包装；复用项目现有组件与主题令牌。
- [Monaco FAQ](https://github.com/microsoft/monaco-editor#faq)：移动浏览器限制。

共享状态回归：`text-editor-autosave.test.ts`、`text-editor-session-cache.test.ts`、`document-editor-registry.test.ts`。真实 Chromium/WebKit 回归：`text-editor-workbench.browser.test.tsx`、`text-editor-layout.browser.test.tsx`、`text-editor-manual-save.browser.test.tsx`、`text-editor-recovery.browser.test.tsx`、`document-workspace.browser.test.tsx`、`document-workspace-tabs.browser.test.tsx`。布局回归覆盖保存文字按钮位置、320/360/680px 容器、真实 Tooltip、非法正则、替换、关闭与焦点恢复、英文与旧版 WebView 回退。Web 三浏览器工作流见 `tests/e2e/app-shell-document-workspace.spec.ts` 等。

浏览器测试使用真实共享组件和主题，文件服务为受控替身；原子写入、路径/编码和权限仍由既有 Node/Rust 边界测试覆盖。实体 IME、移动键盘和各系统原生 WebView 需单独真机验证。执行结果见 `.superwork/plans/2026-10-30-editor-manual-save.md`。
