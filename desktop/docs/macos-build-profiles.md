# macOS 分档构建

同一业务代码生成两档独立产物。Modern 的优化不以 Legacy 的最低能力为上限，CPU 架构与系统能力分别处理。

| 档位 | 最低系统 / WebKit | 架构 | 前端目录 | 更新清单 |
| --- | --- | --- | --- | --- |
| Modern | macOS 14.5 / Safari 17.5 | Apple Silicon、Intel | `dist` | `latest.json` |
| Legacy | macOS 12.4 / Safari 15.5 | Intel | `dist-legacy` | `latest-legacy.json` |

最低系统是构建目标，不代表已经完成该版本的真机验收。当前自动检查能证明编译目标、产物隔离、主题切换与 API 补丁加载，不能把当前 Playwright WebKit 当作 Safari 15.5。

## 构建

使用支持项目 Node.js 24、Rust 工具链和最新 Xcode SDK 的 Mac 或 CI 交叉编译。用户运行安装包不需要 Node.js；不要求在 Monterey 本机编译。

```sh
pnpm install --frozen-lockfile
rustup target add aarch64-apple-darwin x86_64-apple-darwin
pnpm tauri build --target aarch64-apple-darwin
pnpm tauri build --target x86_64-apple-darwin
pnpm tauri:legacy --bundles app,dmg
```

`pnpm tauri build` 默认匹配主机架构。`pnpm tauri:legacy` 固定 Intel，统一设置 `MACOSX_DEPLOYMENT_TARGET=12.4` 并合并兼容配置。Legacy 使用 `src-tauri/target/legacy`，避免覆盖 Modern 缓存和安装包。禁止绕过入口只修改 `minimumSystemVersion`；元数据不能自动兼容依赖或 WebKit。

macOS release 入口设置 `CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_STRIP=false`，规避 macOS 27 对 Rust strip 后异常 proc-macro Mach-O 的拒绝。该覆盖只作用于宿主构建依赖，目标应用仍按 release profile strip，避免扩大安装包。

## 兼容策略

- Modern 保留 Tailwind CSS 4、原生 `light-dark()`、Pierre Diff 和现代 JS 目标。原先的 `14.0` / `safari17.4` 低于已使用的 `light-dark()` 要求，现按官方支持版本对齐为 `14.5` / `safari17.5`。
- Legacy 通过 Vite 官方 `plugin-legacy` 为 Safari 15.5 生成按使用量收集的标准 API 补丁，只生成 ESM，不引入 SystemJS。构建后检查 Modern 不包含补丁和兼容渲染器。
- DOM API 不属于标准语言 polyfill：Legacy 入口在加载应用前补齐 `HTMLFormElement.requestSubmit`，通过原生按钮提交保留校验和 React 事件，覆盖回车发送、输入法确认与换行回归。
- 正则后行断言从 Safari 16.4 才受支持，API polyfill 与 JS target 不能消除该限制。共用的文件链接处理使用捕获组；Legacy 构建单独转换 `remend` 单波浪线规则和 GFM 邮箱边界，依赖规则变化时中止构建。`pnpm test:macos-build-output` 扫描产物正则字面量，并在拒绝后行断言构造器的 WebKit 中加载、渲染任务消息，覆盖懒加载和正文解析阶段的崩溃。
- CSS 使用 PostCSS Preset Env 转换嵌套、颜色函数等可静态处理的语法。运行时变量混色不能靠设置 JS target 解决，Legacy 使用明确的实色表面；不使用持续计算颜色的 JS polyfill。Safari 15.5 原生支持 `:has()` 与 cascade layers，无需对应观察器。
- Legacy Diff 使用 jsdiff 解析 unified patch，保留增删行、双行号与虚拟列表，省去语法/词级 Diff 高亮；避免替旧 WebKit 模拟 constructable stylesheets。代码块仍保留 Shiki 高亮，亮暗 token 由 CSS 切换。
- 不支持 container queries 的旧系统保留表单默认单列布局。视觉特性可以降级，任务执行、审批和数据契约共用。
- 原生新 API 应集中在平台模块，通过 availability / selector 能力检查调用，确保新符号不会在旧系统启动时被强链接。不能仅在 Rust 分支里判断版本后直接引用新符号。
- 官方 Codex 0.156.0 的 Intel 主程序 Mach-O 最低版本为 10.12，内置 zsh 为 15.0（已解包并使用 `otool -l` 核对）。因此 macOS 15 以下在进程参数中关闭 `shell_zsh_fork`，使用标准系统 shell；15 及以上保留用户配置。不修改用户的 Codex 配置文件。

## 发布与更新

Release matrix 构建两个 Modern 架构和一个 Intel Legacy。Legacy 的资源名带 `_legacy`，workflow artifact 名也独立。Legacy 不参与 `tauri-action` 的 `latest.json` 合并；在签名归档上传成功后，单独生成并发布 `latest-legacy.json`。签名仍使用同一套 Tauri updater 密钥。

更新按已安装档位隔离，不会自动从 Legacy 升到 Modern。更新提示复用 GitHub 发布响应，只有当前渠道的清单上传后才提供更新。系统升级后可手动替换同名 `Codexly.app`；Modern 与 Legacy 共用 `com.codexly.desktop` 的本地数据。实际发布和更新签名需要 CI 中已有密钥，本地验证不代替发布签名验收。

## 验证

```sh
pnpm check
pnpm exec playwright install webkit
pnpm test:macos-build-output
pnpm tauri:legacy --debug --no-bundle --no-sign --ci
xcrun vtool -show-build src-tauri/target/legacy/x86_64-apple-darwin/debug/codexly
```

发布前还需在 Intel macOS 12.4 真机验证：安装与首次启动、运行时安装、真实任务和 shell 命令、终端输入/缩放、浅色/深色主题、文件 Diff、大文件滚动、辅助窗口和桌面宠物，以及连续两个已签名版本之间的 Legacy 更新。Modern 在 Intel 和 Apple Silicon 上验证相同核心流程。构建成功或改变 User-Agent 都不能替代真机验证。

## 依据

- [Apple availability checks](https://developer.apple.com/documentation/xcode/running-code-on-a-specific-version)
- [Apple weak linking](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPFrameworks/Concepts/WeakLinking.html)
- [Rust macOS deployment target](https://doc.rust-lang.org/rustc/platform-support/apple-darwin.html)
- [Rust #157750：macOS 27 无法加载 strip 后的动态库](https://github.com/rust-lang/rust/issues/157750)
- [Safari 17.5：light-dark()](https://webkit.org/blog/15383/webkit-features-in-safari-17-5/)
- [Safari 15.4：:has() 与 cascade layers](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/)
- [Vite 官方 Legacy 插件](https://github.com/vitejs/vite/tree/main/packages/plugin-legacy)
- [Tailwind 浏览器支持范围](https://tailwindcss.com/docs/compatibility)：Tailwind 4 本身不承诺支持 Safari 15.5，Legacy 的转换和降级需要本项目维护与测试。
- [PostCSS Preset Env](https://github.com/csstools/postcss-plugins/tree/main/plugin-packs/postcss-preset-env)
- [jsdiff](https://github.com/kpdecker/jsdiff)
- [Tauri updater](https://v2.tauri.app/plugin/updater/)
