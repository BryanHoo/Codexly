# Codexly 联合发布

根目录是 Codexly Web 项目；`desktop/` 是独立的 Codexly Tauri 桌面项目，拥有自己的 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` 与 Rust 工程。两边不共享前后端代码和锁文件，但必须使用同一个版本号与 Git 标签。推送标签后，同一流水线发布 npm 包、GHCR 镜像和桌面安装包，并创建一个 GitHub Release。

## 首次配置

在 npm 的 `@bryanhu/codexly > Settings > Trusted Publisher` 中配置：

| 配置项               | 值            |
| -------------------- | ------------- |
| Organization or user | `BryanHoo`    |
| Repository           | `Codexly`     |
| Workflow filename    | `release.yml` |
| Environment name     | `npm`         |
| Allowed actions      | `npm publish` |

GitHub 仓库必须有名为 `npm` 的 Environment。工作流使用 OIDC 和 npm provenance，不需要长期 npm Token。

另在本仓库配置 `TAURI_SIGNING_PRIVATE_KEY`（私钥设置密码时还需 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`）。桌面更新清单与签名产物只发布在本仓库；旧应用不会通过旧仓更新到新包。新桌面包使用 `com.codexly.desktop`，与旧应用的数据目录相互独立。

## 发布步骤

1. 将根目录 `package.json` 与 `desktop/package.json`、`desktop/src-tauri/tauri.conf.json`、`desktop/src-tauri/Cargo.toml` 和 Cargo lock 更新为同一递增版本号。
2. 分别将根目录和 `desktop/CHANGELOG.md` 的 `Unreleased` 内容移入对应版本，并填写发布日期。
3. 运行发布校验：

```bash
pnpm check
pnpm test:e2e
cd desktop && pnpm install --frozen-lockfile && pnpm check
```

4. 提交发布准备后，创建并推送与根目录 `package.json` 版本一致的标签：

```bash
RELEASE_VERSION=x.y.z
git tag -a "v${RELEASE_VERSION}" -m "发布 v${RELEASE_VERSION}"
git push origin main
git push origin "v${RELEASE_VERSION}"
```

工作流先验证统一版本与两端日志，并运行 Web E2E、桌面质量和真实 WebView 门禁；全部通过后按 Windows、Ubuntu、macOS 矩阵构建签名桌面更新产物到草稿 Release，随后发布 npm 包与多架构镜像，最后公开联合 Release。桌面发行物以 Codexly 命名。内部 Workspace 包仍保持私有。

## 失败恢复

- 已推送标签的工作流失败：手动运行 `Release` workflow，并将 `tag` 设置为原标签。
- npm 已发布但 GitHub Release 失败：重跑失败 Job；工作流会跳过已存在的 npm 版本。
- npm 已发布但 GHCR 镜像失败：重跑失败 Job；npm Job 会检测并跳过已发布版本。
- 桌面构建失败：联合 Release 保持草稿；修复同标签的流水线配置后重跑，已经发布的 npm 版本会跳过。不要在已发布标签上替换源码。
- `ENEEDAUTH` 或 OIDC 失败：检查 Trusted Publisher、`release.yml`、`npm` Environment 和 `id-token: write` 是否一致。
- `EUNSUPPORTEDPROTOCOL`：确认发布对象来自 `pnpm pack`，并检查 `pnpm run package:check`。
- 版本或标签错误：未发布时修正；版本已发布后必须提升版本号并创建新标签。

发布结果以 [npm](https://www.npmjs.com/package/@bryanhu/codexly)、[GHCR](https://github.com/BryanHoo/Codexly/pkgs/container/codexly) 和包含桌面安装包的 [GitHub Releases](https://github.com/BryanHoo/Codexly/releases) 为准。两端 CI 与联合发布工作流统一维护在根目录 `.github/workflows/`。
