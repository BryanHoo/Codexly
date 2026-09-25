# Tauri 后端质量规范

## 规则

- 保持 `unsafe_code = "forbid"`
- 错误统一转换为 `src-tauri/src/application/error.rs` 暴露的应用错误
- 对领域状态、序列化契约和错误分支添加就近单元测试
- 不在日志或 IPC 错误中暴露凭据、完整环境变量或敏感路径
- 覆盖日志脱敏、字段与单行上限、Codex stderr 有界排水、归档白名单和导出总量限制
- 诊断日志遵循 [排障字段与事件约定](../../../../docs/diagnostics.md)：关键 RPC 开始/终态共享操作与连接编号，记录总预算和失败阶段；任务终态与 Provider 错误保留脱敏作用域；stderr 丢失首次立即报告并定期汇总。回归通过实际 logger 输出验证关联、取消、超时、错误链和丢失计数，禁止记录请求正文与完整响应。
- Git 仓库选择层统一规范化根仓库和子仓库路径，不能依赖上层调用者已处理 Windows 普通路径与 `\\?\` 路径差异。用中文父目录、中文项目及文件名覆盖真实 Git 状态和差异读取；保留仓库边界校验。状态错误应区分读取阶段与输出超限，不把输出超限归类为无效路径。
- Git 状态中的未跟踪目录保持聚合；生成提交信息时仅按需展开所选目录，遵循 Git ignore 规则及字面量路径语义，不能将目录当文件读取。目录列表与文件正文均须有界，提交上下文维持 512 KiB 上限，并覆盖目录选择、忽略文件、特殊路径和容量限制。

## 验证

- 格式检查：`pnpm rust:fmt:check`
- 静态检查：`pnpm rust:clippy`
- 测试：`pnpm rust:test`
- 完整后端检查：`pnpm check:rust`

- 手写源文件和测试文件不得超过 500 行；`pnpm source:lines` 覆盖已跟踪及新增文件，通过 `pnpm check:web` 和总入口 `pnpm check` 执行。
- `pnpm performance:rust` 必须使用 `--release`；Debug 功能测试结果不能作为发布性能基线。记录内存时区分索引预算、进程 RSS 采样和峰值。

- Git 查询必须使用无可选锁入口与稳定 NUL 协议；stdout 超限只能保留连续前缀，状态、路径清单与 index 条目必须流式消费，按快照分页传输，不能因文件数量触发 2 MiB 容量错误；引用等有界单次结果超限须报独立错误。Diff 截断必须重建末尾 hunk 并透传 `truncated`，目录和 gitlink 的内容身份须进入快照。具体边界及来源见 [Git 读取设计](../../../../docs/git-read-design.md)。

- 大批量 Git 选择不能逐路径拼接无限 argv：add/reset 使用 NUL stdin pathspec，index 复制使用 index-info；保持所选暂存内容与工作区隔离。分页缓存必须同时限制内存和存活时间，失效游标返回新首页或重新扫描续页，不能拼接不同快照。
