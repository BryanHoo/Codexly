# Codexly 联合发布

根目录统一管理 Codexly Web 与 `desktop/` Tauri 应用的 pnpm workspace 和锁文件；桌面端保留自己的 `package.json` 与 Rust 工程。两边使用同一个版本号与 Git 标签。推送标签后，同一流水线发布 npm 包和桌面安装包，并创建一个 GitHub Release。桌面包内置目标平台运行时；Windows 便携版发布完整 ZIP，macOS Legacy 仅提供 Codex。

## 发布环境

发布环境与权限由维护者管理，凭据只在仓库受控环境中配置，本地配置不进入版本控制。桌面更新清单与签名产物只发布在本仓库；旧应用不会通过旧仓更新到新包。新桌面包使用 `com.codexly.desktop`，与旧应用的数据目录相互独立。

## 发布步骤

先检查自上次标签以来的实际变更，按兼容性决定版本：仅修复、依赖维护或文档更新升补丁号；新增兼容功能升次版本号；不兼容变更才升主版本号。当前处于 `0.x` 阶段，仍按实际影响判断，不能每次发布都升主版本号。Web 与桌面始终共用同一版本；其中一端新增功能也会提升联合版本的次版本号。

1. 将根目录 `package.json` 与 `desktop/package.json`、`desktop/src-tauri/tauri.conf.json`、`desktop/src-tauri/Cargo.toml` 和 Cargo lock 更新为同一递增版本号。
2. 仅在根目录 `CHANGELOG.md` 将两端的 `Unreleased` 内容合并到对应版本，并填写发布日期；若 `Unreleased` 为空，仍须核对上次正式标签以来的提交。共用功能写一次，平台专属变化注明适用端，不再维护桌面端独立日志。更新底部版本对比链接及 `Unreleased` 的起始标签，同步核对 `README.md`、`README.zh-CN.md`、`desktop/README.md` 和 `desktop/README.en.md` 的用户功能与安装说明；历史测试报告保留实际验证时的版本号。
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

发布完成后确认 `Release` 工作流成功，检查 npm 版本，以及 GitHub Release 的 Windows、Ubuntu、macOS 安装包、`latest.json`、`latest-legacy.json` 和对应签名。更新清单中的版本与下载地址必须指向本次发布；只有全部任务成功、联合 Release 已公开且产物齐全，才算发布完成。

## 失败恢复

- 已推送标签因临时网络或外部服务故障失败：重跑失败 Job，或手动运行 `Release` workflow，并将 `tag` 设置为原标签。
- npm 已发布但 GitHub Release 失败：重跑失败 Job；工作流会跳过已存在的 npm 版本。
- 代码、测试或工作流需要修改：保留原标签的不可变提交，修复后同步递增两端版本、更新日志与安装说明，提交并创建新标签。即使原版本尚未公开，也不要移动已推送标签；新版本的日志应包含上次正式发布以来的全部变化。
- 桌面构建失败：联合 Release 保持草稿；临时环境故障可重跑，需要修改仓库文件则按上一条发布新版本。已经发布的 npm 版本会跳过。
- 发布认证失败：由维护者核对发布环境与授权配置，不在公开 Issue 或日志中提交凭据与账户信息。
- `EUNSUPPORTEDPROTOCOL`：确认发布对象来自 `pnpm pack`，并检查 `pnpm run package:check`。
- 版本或标签错误：未发布时修正；版本已发布后必须提升版本号并创建新标签。

发布结果以 [npm](https://www.npmjs.com/package/@bryanhu/codexly) 和包含桌面安装包的 [GitHub Releases](https://github.com/BryanHoo/Codexly/releases) 为准。两端 CI 与联合发布工作流统一维护在根目录 `.github/workflows/`。
