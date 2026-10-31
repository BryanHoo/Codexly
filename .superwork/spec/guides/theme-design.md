# 共享主题与文件配色

- Web、移动浏览器和桌面的颜色、状态色与阴影统一维护在 `packages/ui/src/core/theme-tokens.css`，由两端全局 CSS 在构建时导入。新增表面使用语义令牌，避免在应用内复制另一份色板。
- 默认暗色采用柔和炭灰表面和灰白正文，浮层逐级提亮。正文避免纯白；正文、次级文字与实际表面的对比度至少为 4.5:1。壁纸模式的显式前景回退也沿用该规则。
- 文件编辑与预览采用 GitHub Light / Dark Dimmed。`file-theme.css` 的 `.file-theme` 在文件范围内统一工具栏、正文、Markdown、行号和搜索配色；聊天及 Portal 浮层保持工作台语义。
- CodeMirror 和 Shiki 的主题切换只通过 CSS 更新，不为主题切换重新创建编辑器、解析器、token 缓存、草稿、选区或撤销历史；沿用语法懒加载、虚拟行与有界处理预算。
- 源码预览包括未高亮和大文件降级路径，底色与普通正文都应由文件主题控制，不能高亮后突然切换背景。
- 验证入口：`desktop/src/shared/components/core/file-theme.browser.test.tsx` 在 Chromium / WebKit、320px 下验证实际对比度、GitHub 配色和切换后的编辑状态；Web 的 `app-shell-settings-defaults.spec.ts` 验证正式构建令牌。同步检查编辑器搜索、保存和恢复用例、现代与 Legacy 构建及两端包体预算。

官方依据：[Primer 主题](https://primer.style/product/primitives/)、[GitHub 编辑器主题](https://github.com/primer/github-vscode-theme)、[Atlassian 暗色表面层级](https://atlassian.design/foundations/elevation)、[CodeMirror 样式接口](https://codemirror.net/examples/styling/)。
