# 发布 Codexly

仓库只发布根包 `@bryanhu/codexly`；内部 Workspace 包保持私有。推送版本标签后，GitHub Actions 自动发布 npm 包并创建 GitHub Release。

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

## 发布步骤

1. 更新 `package.json` 的版本号。
2. 将 `CHANGELOG.md` 的 `Unreleased` 内容移入新版本，并填写发布日期。
3. 运行发布校验：

```bash
pnpm check
pnpm test:e2e
```

4. 提交发布准备后，创建并推送与 `package.json` 版本一致的标签：

```bash
RELEASE_VERSION=x.y.z
git tag -a "v${RELEASE_VERSION}" -m "发布 v${RELEASE_VERSION}"
git push origin main
git push origin "v${RELEASE_VERSION}"
```

工作流会校验标签和包版本，运行 `pnpm check`，通过 `pnpm pack` 转换 `catalog:` 与 `workspace:` 协议，再使用 npm CLI 发布 tarball。npm 发布成功后才创建 GitHub Release。

## 失败恢复

- 已推送标签的工作流失败：手动运行 `Release` workflow，并将 `tag` 设置为原标签。
- npm 已发布但 GitHub Release 失败：重跑失败 Job；工作流会跳过已存在的 npm 版本。
- `ENEEDAUTH` 或 OIDC 失败：检查 Trusted Publisher、`release.yml`、`npm` Environment 和 `id-token: write` 是否一致。
- `EUNSUPPORTEDPROTOCOL`：确认发布对象来自 `pnpm pack`，并检查 `pnpm run package:check`。
- 版本或标签错误：未发布时修正；版本已发布后必须提升版本号并创建新标签。

发布结果以 [npm](https://www.npmjs.com/package/@bryanhu/codexly) 和 [GitHub Releases](https://github.com/BryanHoo/Codexly/releases) 为准。
