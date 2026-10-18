# Codex / Claude 独立运行验证

验证日期：2026-10-18；本机 macOS arm64。所有真实推理均显式使用 `gpt-6-luna`。扩展中心的 Claude 接入不在本次范围。

## 环境与真实 API

使用本机 `~/.codex/config.toml`、`auth.json` 及 `~/.claude/settings.json` 中的实际服务和凭据。隔离测试只复制所需引擎的配置到各自临时目录，显式设置 `CODEX_HOME` / `CLAUDE_CONFIG_DIR`，清除继承的另一引擎认证变量。仅 Claude 场景还将 Codex 可执行文件指向不存在的路径。

本机原生配置启动另有单独验证；Claude 仅通过该服务进程的 `ANTHROPIC_MODEL` 覆盖验证模型。全局默认模型保持 Codex `gpt-6.1-sol`、Claude `haiku`，没有为测试改写它们。

| 实际调用           | 结果                           |
| ------------------ | ------------------------------ |
| Codex 原生模型目录 | HTTP 200，包含 `gpt-6-luna`    |
| OpenAI Responses   | HTTP 200，回复 `CODEX_API_OK`  |
| Claude 模型目录    | HTTP 200，包含 `gpt-6-luna`    |
| Anthropic Messages | HTTP 200，回复 `CLAUDE_API_OK` |

## 验证矩阵

| 环境                      | 引擎               | 创建及真实对话 | 两轮上下文         | 服务重启后恢复和工具写入                         |
| ------------------------- | ------------------ | -------------- | ------------------ | ------------------------------------------------ |
| 本机原生配置              | Codex、Claude      | 通过           | 通过               | 原生配置仅验证两轮对话；重启与工具在隔离目录验证 |
| 仅 Codex                  | Codex              | 通过           | 通过               | 通过，实际生成 `codex-proof.txt`                 |
| 仅 Claude，Codex 不可执行 | Claude             | 通过           | 通过               | 通过，审批后实际生成 `claude-proof.txt`          |
| 两者都有                  | Codex、Claude 并行 | 通过           | 各自返回自己的令牌 | 两者均通过                                       |

另在仅 Codex 环境放入损坏的 Claude JSON、仅 Claude 环境放入损坏的 Codex TOML 后重启，已配置引擎仍可恢复上下文并写入文件。主动探测不可用 Codex 会失败，但不会破坏 Claude 聊天或历史；没有 Claude 凭据时，全局 Claude 探测正确显示未连接。

独立桌面 Claude 宿主也使用真实 API 验证了仅 Claude、双配置两种环境：模型对话、工具审批、文件实际落盘、宿主进程重启、原生 sessionId 不变及上下文恢复均通过。单 Claude 宿主的 `commit.generate` 返回 `feat(proof): 新增验证标记文件`；单 Codex 配置下宿主的 Claude 全局状态为未连接。

## 发现并修复

1. **Claude 全局探测误读默认目录。** 全局探测以用户主目录为 cwd，并启用项目设置源，导致空 `CLAUDE_CONFIG_DIR` 意外加载主目录下的 `.claude/settings.json`。改为全局仅使用 `user`，具体项目按偏好追加 `project/local`，缓存同时区分范围与路径。
2. **公共设置依赖 Codex。** 仅 Claude 时公共偏好读写和模型目录使用 Claude 范围，保存只更新应用字段。两端复用查询逻辑，缓存区分引擎，保留桌面响应的扩展字段。
3. **Git 提交说明固定使用 Codex。** 请求支持显式引擎；共享面板仅启用 Claude 时发送 Claude 范围。Web 与桌面宿主复用无工具、无持久聊天的 Claude 短请求，有截止时间与并发上限。仅 Claude 实际 HTTP 请求已从原先 502 变为 200，且未创建提交或推送。
4. **空闲 Claude 异步问题使用 Codex 模型校验。** 改为按任务引擎校验，回归用例使 Codex 不可用，确认答案仍能启动原聊天回合。
5. **桌面本地文件功能依赖 Codex 连接。** 项目根目录校验、相对文件预览、Git 和终端从应用目录读取归属，继续校验项目、任务和已登记工作树。新增无需引擎进程的 Rust 行为测试和原生约束检查。

另对仓库已有四个审计文件执行格式整理，以解除原有格式门禁失败；没有改动其结论或数据。

## 检查与证据

- `pnpm check`：通过。563 个测试文件通过，3066 个用例通过，24 个既有用例跳过；性能测试另有 16 个用例通过。类型、格式、lint、架构、依赖审计、Codex schema、生产构建、体积预算及打包检查通过。
- Web 初始压缩资源约 301.77 KiB / 320 KiB；工作区就绪约 429.17 KiB / 500 KiB，31 个请求。
- `pnpm test:claude-host`：10 个用例通过。
- 桌面 `pnpm check`：通过。前端 151 个测试文件、575 个用例通过；Rust 774 个用例通过，10 个手动性能用例在普通测试阶段跳过；独立发行模式执行的 6 项性能基线全部通过。另有两组原生集成测试各 3 个用例通过。格式、Clippy、原生约束、现代及 Legacy 构建和资源预算均通过。
- Chrome DevTools MCP 连接本机 Chrome：确认三种隔离环境恢复正确的启用引擎；单引擎隐藏切换入口、双引擎切换到 Claude 后实际回复正确；单 Claude 公共设置保存 HTTP 200，Git 模型目录正确，刷新后历史保留。390px 视口无横向溢出，复查控制台无错误。

隔离服务与测试标签页已关闭，复制的凭据配置已清理；使用原生配置的主服务继续运行于 `http://127.0.0.1:3210`。

脱敏结果及运行日志位于 Git 忽略的 `.local/engine-matrix/`；完整检查日志分别为 `.local/engine-independence-web-check.log`、`.local/engine-independence-desktop-check.log` 和 `.local/engine-independence-final-host-check.log`。这些日志不作为全平台实机证明。

本次没有执行 Windows、Ubuntu 实机或桌面原生 WebView 的完整界面验收；桌面证据包括本机 Rust/前端检查、独立原生宿主真实 API 以及浏览器中的共享界面验证。浏览器操作全部通过 Chrome DevTools MCP/CDP。
