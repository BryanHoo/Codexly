# 浏览器与宿主跨系统文件边界修复

## 目标与边界

Web/移动浏览器按服务端宿主语义访问文件；桌面保留原生传输，共享可复用的路径拼接与文档身份规则。不改变公开协议结构，不增加后台轮询或逐键网络请求。

登记：`cross-host-files-20261030`，执行者：`codex-cross-host-files`。

## 已确认根因与修复

1. 两端菜单和文件引用把所有反斜杠替换为分隔符，或剥离 POSIX 根目录末尾的合法反斜杠。改为共用 `packages/frontend-core/src/host-path.ts`，依据宿主绝对路径识别 Windows 语法。
2. 文档身份把 POSIX 的 `a\b.txt` 与 `a/b.txt` 合并，Windows 扩展路径与普通路径却分裂。仅规范 Windows 分隔符及扩展前缀，保留大小写与 Unicode 形式，网络请求保持原路径。
3. 根目录选择无条件忽略大小写并按原始前缀匹配。改为完整目录边界、最长根匹配，仅 Windows 比较忽略大小写。
4. Node/Rust 文本编辑把 POSIX 冒号和反斜杠误作 Windows 语法。按宿主规则解析，Windows 继续拒绝数据流冒号，逐段链接校验和条件保存保持有效。
5. 原生及 HTTP 重命名未统一采用新建的可移植名称规则。复用已有校验，任何宿主都拒绝设备保留名、控制字符和末尾点/空格。

## 官方依据

- [Node.js Windows/POSIX 路径及示例](https://nodejs.org/api/path.html#windows-vs-posix)。
- [Node.js 不同文件系统最佳实践](https://nodejs.org/en/learn/manipulating-files/working-with-different-filesystems)。
- [Microsoft 命名、UNC 与保留字符](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file)。
- [CodeMirror 状态与行分隔符](https://codemirror.net/docs/ref/)。
- [MDN Blob 换行选项](https://developer.mozilla.org/en-US/docs/Web/API/Blob/Blob)：默认透明保留换行，不能因客户端系统隐式转换。

## 验证证据

环境：macOS arm64，仓库固定 pnpm 11.22.0，Node/Rust 原有锁文件未改动。以下命令均从仓库根目录执行。

- RED：共享路径、文档身份、目录根、Node 重命名和文本编辑的首轮 Vitest 运行出现 24 项预期失败；18 项通过、1 项平台跳过。日志 `.local/cross-host-red.log`。最初跨应用测试随后归位至共享包及各应用，避免跨越 TypeScript composite 项目边界。
- RED：Rust `posix_filename_characters` 因 `TextFileUnsupported` 失败；`rename_should_reject_nonportable_names_on_every_host` 因接受 `CON` 失败。
- GREEN：相关 Node/HTTP/Client/共享/应用 11 个测试文件首轮 82 项通过、1 项跨 Windows 盘符环境跳过；日志 `.local/cross-host-targeted.log`。后续新增共享和两端路径用例纳入完整测试。
- GREEN：`cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib --locked infrastructure::workspace`：114 项通过、5 项显式性能测试忽略；日志 `.local/cross-host-rust-green.log`。
- GREEN：`pnpm --dir desktop test:browser text-editor-recovery text-editor-manual-save`：Chromium/WebKit 共 8 项通过；日志 `.local/cross-host-editor-browser.log`。覆盖跨换行粘贴、手动保存和失败恢复；此后编辑器状态、正文处理与这些用例的传输桩未变，证据仍有效。
- HTTP 新增四组 Windows/Linux 浏览器标识 × LF/CRLF：中文、表情、BOM、含 `#&+%` 的路径与原始 UTF-8 字节一致；旧版本保存返回 409。此为宿主 I/O 加 HTTP 注入测试，不代表在 Windows/Linux 实机运行。
- `pnpm test --maxWorkers=2`：666 个文件通过、6 个文件按现有条件跳过；3868 项通过、12 项跳过，退出码 0。日志 `.local/cross-host-full-tests.log`。最初默认并发的 `pnpm check` 在高负载下触发模型缓存用例 15 秒限时，主动终止后改为限并发完整复核；该文件另外单独运行 10 项通过，没有修改无关实现。
- 最后一次路径工具精简之后，`host-path`、`document-presentation`、根目录选择及 Web 菜单/引用定向测试重新通过：根路径组 32 项。此前桌面相关组 10 项、Node 文件/名称组 42 项通过（另有 1 项平台跳过）；最终桌面完整检查再次覆盖修改后的路径消费者。日志 `.local/cross-host-path-final.log`、`.local/cross-host-desktop-final-targeted.log`、`.local/cross-host-core-final-targeted.log`。全量检查期间最后的改动仅限纯路径精简，这些新增验证及最终生产工作流补齐其证据；服务端实现与原生实现此后未改动。
- `pnpm --dir desktop check:web`：最终完整通过，包含 677 项测试、源码行数、Lint、类型、Tauri/Legacy 约束、现代/Legacy 构建与包体检查。日志 `.local/cross-host-desktop-web-final.log`。
- `pnpm --dir desktop check:rust`：完整通过，包含格式、全目标全特性 Clippy、814 项单元测试、6 项集成测试及 6 项 Release 性能基线。全特性单元测试中的 9 项为既有显式忽略用例；6 项 Release 性能基线由独立命令实际执行。日志 `.local/cross-host-desktop-rust.log`。
- `pnpm exec playwright test tests/e2e/app-shell-file-creation.spec.ts tests/e2e/app-shell-document-workspace.spec.ts --workers=2`：Chromium/Firefox/WebKit 共 24 项通过，覆盖桌面宽度和移动触屏。使用最后一次修改后构建的生产资源，日志 `.local/cross-host-e2e.log`。
- `pnpm test:performance`：17 项通过；`pnpm build`、`pnpm bundle:check`、`pnpm package:check`、最终 Lint 和架构检查均通过。发布脚本测试及高亮插件测试分别通过。日志为 `.local/cross-host-performance.log`、`.local/cross-host-web-build.log`、`.local/cross-host-web-budget.log`、`.local/cross-host-package.log`、`.local/cross-host-lint-final.log`、`.local/cross-host-architecture-final.log`、`.local/cross-host-release-tests.log`、`.local/cross-host-highlight-tests.log`。
- 原预算保持不变。桌面 textEditor 场景最终为 2,149,993 字节，上限 2,150,000；最初超出 121 字节，通过去除相对路径上重复的兼容处理及精简规范化逻辑消除超标。没有增加依赖、轮询、正文传输或运行时缓存。
- 依赖审计无已知漏洞、Codex Schema 0.164.0 校验、根格式检查由原完整检查复用；相关包元数据、锁文件与 Schema 未改变，最后新增/修改的文件另外执行格式校验。

## 最终审查

- 简化结论：`changed`；路径拼接收敛到共享纯函数，桌面名称校验复用现有 Rust 创建规则；最终根据项目相对路径契约移除重复处理，完成定向回归、两端构建与预算复验，无需新增平台层或依赖。
- 规范结论：`update`；长期边界更新到 `cross-platform-thinking-guide.md`，用户说明更新到 `docs/text-file-editing.md`，两者均由现有导航可达。
- 尚未验证：Windows/Linux 真机的文件锁、ACL、网络盘与原生 WebView；浏览器系统标识与纯路径测试不能替代这些实机证据。
