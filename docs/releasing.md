# Codexly 联合发布

根目录统一管理 Codexly Web 与 `desktop/` Tauri 应用的 pnpm workspace 和锁文件；桌面端保留自己的 `package.json` 与 Rust 工程。两边使用同一个版本号与 Git 标签。推送标签后，同一流水线发布 npm 包和桌面安装包，并创建一个 GitHub Release。桌面包内置目标平台运行时；Windows 便携版发布完整 ZIP，macOS Legacy 仅提供 Codex。

## 发布环境

发布环境与权限由维护者管理，凭据只在仓库受控环境中配置，本地配置不进入版本控制。桌面更新清单与签名产物只发布在本仓库；旧应用不会通过旧仓更新到新包。新桌面包使用 `com.codexly.desktop`，与旧应用的数据目录相互独立。

## 更新日志写法

`CHANGELOG.md` 用于 GitHub Release 和应用内更新页，面向产品使用者。

- 通常每版 3–6 条，每条一句；大版本仅增加必要条目。
- 按新增、优化、修复分组，合并同类变化，删去重复的平台说明。
- 保留核心功能、重要修复和兼容限制；操作步骤与工程细节放专项文档。
- 保留版本标题、日期、顺序、`Unreleased` 和对比链接，不改变历史事实。

更新后运行 `node --test tools/joint-release.test.mjs desktop/scripts/changelog.test.mjs`。

## 发布步骤

先检查自上次标签以来的实际变更，按兼容性决定版本：仅修复、依赖维护或文档更新升补丁号；新增兼容功能升次版本号；不兼容变更才升主版本号。当前处于 `0.x` 阶段，仍按实际影响判断，不能每次发布都升主版本号。Web 与桌面始终共用同一版本；其中一端新增功能也会提升联合版本的次版本号。

1. 将根目录 `package.json` 与 `desktop/package.json`、`desktop/src-tauri/tauri.conf.json`、`desktop/src-tauri/Cargo.toml` 和 Cargo lock 更新为同一递增版本号。
2. 仅在根目录 `CHANGELOG.md` 将两端的 `Unreleased` 内容合并到对应版本，并填写发布日期；若 `Unreleased` 为空，仍须核对上次正式标签以来的提交。共用功能写一次，平台专属变化注明适用端，不再维护桌面端独立日志。更新底部版本对比链接及 `Unreleased` 的起始标签，同步核对 `README.md`（中文首页）、`README.en.md`、`desktop/README.md` 和 `desktop/README.en.md` 的用户功能与安装说明；历史测试报告保留实际验证时的版本号。
3. 运行发布校验（包含 Claude 宿主与实际桌面运行时布局）：

```bash
pnpm install --frozen-lockfile
RELEASE_TAG=vx.y.z node tools/joint-release.mjs --check
RELEASE_TAG=vx.y.z pnpm --dir desktop version:check
pnpm check
pnpm test:claude-host
pnpm build:desktop-runtime
node --test tools/desktop-runtime-bundle.test.mjs
pnpm test:e2e
cd desktop && pnpm check
```

4. 将功能分支合并到最新 `main` 并提交发布准备后，创建并推送与根目录 `package.json` 版本一致的标签；主分支与标签应指向同一发布提交：

```bash
RELEASE_VERSION=x.y.z
git tag -a "v${RELEASE_VERSION}" -m "发布 v${RELEASE_VERSION}"
git push origin main
git push origin "v${RELEASE_VERSION}"
```

工作流先验证统一版本与根目录联合日志，并运行 Web E2E、桌面质量和真实 WebView 门禁；全部通过后按 Windows、Ubuntu、macOS 矩阵构建签名桌面更新产物到草稿 Release，随后发布 npm 包，最后公开联合 Release。GitHub Release 页面标题统一为 `Codexly v<版本号>`；正文只提取根目录对应版本的合并更新内容，不再添加产品或版本标题，首行保留桌面更新检查所需的隐藏标记 `<!-- codeagent-version: <版本号> -->`。桌面应用离线日志也内置根目录同一文件。桌面发行物以 Codexly 命名。内部 Workspace 包仍保持私有。

Web E2E 与普通 CI 的 E2E、质量任务均使用 30 分钟任务上限：E2E 包含浏览器及系统依赖安装、构建和测试，质量任务还须容纳 Linux 的完整覆盖率检查，避免冷环境安装与两轮测试耗尽时间。覆盖率阈值和性能预算保持独立校验。

发布完成后确认 `Release` 工作流成功，检查 npm 版本，以及 GitHub Release 的 Windows、Ubuntu、macOS 安装包、`latest.json`、`latest-legacy.json` 和对应签名。更新清单中的版本与下载地址必须指向本次发布；只有全部任务成功、联合 Release 已公开且产物齐全，才算发布完成。

## 失败恢复

- 已推送标签因临时网络或外部服务故障失败：重跑失败 Job，或手动运行 `Release` workflow，并将 `tag` 设置为原标签。
- npm 已发布但 GitHub Release 失败：重跑失败 Job；工作流会跳过已存在的 npm 版本。
- npm 命令成功但提示包仍在处理中：这表示平台已接收，版本尚不一定可安装；等待官方 Registry 出现目标版本且 `latest` 指向本次发布，再核验公开 tarball。处理期间不重复发布同一版本，不重建或移动标签；扫描可能带来可用性延迟，见 [npm 官方说明](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/)。
- 代码、测试或工作流需要修改：保留原标签的不可变提交，修复后同步递增两端版本、更新日志与安装说明，提交并创建新标签。即使原版本尚未公开，也不要移动已推送标签；新版本的日志应包含上次正式发布以来的全部变化。
- 桌面构建失败：联合 Release 保持草稿；临时环境故障可重跑，需要修改仓库文件则按上一条发布新版本。已经发布的 npm 版本会跳过。
- 桌面浏览器组件测试失败：检查 `Desktop Quality → Web → Check browser components` 的具体用例与错误，下载该次运行的 `desktop-browser-failure-<run_id>` 产物，核对 JSON 测试报告和截图；本地使用 `pnpm --dir desktop test:browser` 复现，覆盖 Chromium 与 WebKit。WebKit 操作返回后，先等待页面目标状态，再断言异步调用次数。
- 出现 `Browser connection was closed` 或 `rpc is closed` 时，先核对未处理错误、已完成文件数和退出码；中断时 JSON 报告可能仍显示 `success: true`，不能据此认定全套通过。使用 `gh run rerun <run_id> --failed --debug` 收集 runner 调试信息，本地可用 `DEBUG=vite:deps,pw:browser pnpm --dir desktop test:browser` 区分依赖重载和浏览器进程退出；仅确认属于临时环境故障时才重跑原提交。
- CI 使用 `pnpm --dir desktop test:browser:ci`：只有有效报告中没有失败断言、退出码非零且日志仅报告一次明确的浏览器连接中断时，才启动全新进程完整重跑一次。断言失败、报告缺失或损坏、其他异常及再次中断均阻断发布。两次日志与 JSON 分别保存为 `browser-attempt-1.*`、`browser-attempt-2.*`；恢复成功也上传现场，不能把第一次未完成的报告算作通过。整个浏览器步骤上限为 10 分钟，失联且不退出时同样阻断；本地普通 `test:browser` 保持单次执行。
- 发布认证失败：由维护者核对发布环境与授权配置，不在公开 Issue 或日志中提交凭据与账户信息。
- `EUNSUPPORTEDPROTOCOL`：确认发布对象来自 `pnpm pack`，并检查 `pnpm run package:check`。
- 版本或标签错误：未发布时修正；版本已发布后必须提升版本号并创建新标签。

发布结果以 [npm](https://www.npmjs.com/package/@bryanhu/codexly) 和包含桌面安装包的 [GitHub Releases](https://github.com/BryanHoo/Codexly/releases) 为准。两端 CI 与联合发布工作流统一维护在根目录 `.github/workflows/`。
