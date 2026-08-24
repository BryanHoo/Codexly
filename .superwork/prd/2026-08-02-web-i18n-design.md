# Web 中英文国际化设计

## Goal

为 Web 工作台添加简体中文与英文界面，用户可在全局设置的“外观”分类即时切换并持久化语言偏好。翻译覆盖应用自有的可见文案、可访问名称、通知、错误与状态文本，同时保持 AI/用户消息、命令、路径、模型标识及服务端动态内容原样。

## Suggested Spec Reads

- `.superwork/spec/guides/index.md`
- `.superwork/spec/frontend/index.md`
- `.superwork/spec/frontend/component-guidelines.md`
- `.superwork/spec/frontend/state-management.md`
- `.superwork/spec/frontend/quality-guidelines.md`
- `docs/web-design.md`

## Existing Context

- Web 使用 React 19、Vite 8 与 Vitest，当前没有国际化依赖。
- 界面文案分布在设置、工作台、Timeline、Inspector、Diff、审批、共享 AI Elements 和浏览器通知中。
- 主题与其他浏览器偏好已采用带版本的 `localStorage` 数据，语言偏好可沿用相同边界，无需修改 Server 或 Protocol。
- 模型数据来自 Codex `model/list`，`displayName`、`description`、`supportedReasoningEfforts` 等服务端值应保持原样；应用自有标签按官方术语显示。
- OpenAI 官方文档使用 `reasoning effort`、`Approval policy`、`Sandbox`，并使用 `minimal`、`low`、`medium`、`high`、`xhigh` 作为 effort 值；英文界面据此使用 `Reasoning effort`、`Minimal`、`Low`、`Medium`、`High`、`Extra high`。

## Considered Approaches

### 1. `i18next` + `react-i18next` + 浏览器偏好（推荐）

- 使用成熟的语言回退、复数、插值与 React 更新机制。
- 资源按功能命名空间拆分，便于持续维护和检查资源完整性。
- 语言切换只影响前端展示，不扩大后端契约。
- 代价是增加两个小型运行时依赖，并需要逐步把硬编码文案迁移为稳定 key。

### 2. 自建 TypeScript 字典与 Context

- 依赖最少，初始代码量较小。
- 需要自行实现回退、复数、插值、资源检查和 React 订阅，后续扩展风险更高，不符合“按 i18n 最佳实践”的长期目标。

### 3. Server 持久化语言并下发本地化内容

- 可跨浏览器同步偏好，也能让服务端错误本地化。
- 当前没有账号同步需求，会引入 Protocol、数据库与 Server 改造；AI/Provider 动态内容也不应由应用翻译，因此收益不足。

## Recommended Approach

采用方案 1。语言标签固定为 BCP 47 的 `zh-CN` 与 `en`；首次访问优先读取版本化浏览器偏好，没有偏好时按 `navigator.languages` 选择支持语言，无法匹配则回退到 `zh-CN`，保持现有用户体验。生产回退语言显式设为 `zh-CN`。

翻译资源使用语义 key，并按 `common`、`settings`、`workbench`、`conversation` 等功能边界拆分。完整句子进入资源文件，只有数量、名称、时间、路径等运行时值使用插值；React 负责最终转义。日期和时长使用当前语言对应的 `Intl` locale。

## Component Responsibilities And Interfaces

### I18n Bootstrap

- 在 React 挂载前初始化唯一 `i18next` 实例，注册静态资源与 `initReactI18next`。
- `AppProviders` 提供 `I18nextProvider`，组件通过 `useTranslation(namespace)` 订阅语言变化。
- 每次语言变化同步 `document.documentElement.lang`，使用规范化的 BCP 47 标签。

### Language Preference

- `language-preference.ts` 负责校验、读取、保存和解析浏览器语言。
- 存储格式为 `{ "language": "zh-CN" | "en", "version": 1 }`；损坏、禁用或未知值只影响持久化，不阻断界面。
- 设置 Dialog 在“外观”分类提供语言选择，选择后立即切换并保存，不随服务端全局设置 Mutation 回滚。

### Translation Resources

- 中文资源保留现有产品语气；英文资源使用自然的产品文案，并以 Codex 官方英文术语为准。
- 翻译应用拥有的文本：导航、按钮、菜单、Dialog、状态、错误、Toast、系统通知、ARIA 文案与空状态。
- 不翻译动态内容：用户消息、Assistant 输出、Command、Tool/Activity 原始名称、Plan 原文、路径、分支、文件名、Skill 名称、MCP 名称、模型 ID、模型展示名及服务端描述。
- 保留专有名词：`Codexly`、`Codex`、`Agent`、`AI`、`MCP`、`Git`、`Turn`、`Skill`、`Token`、`Diff`、`CLI`、`Runtime`。

### Formatting

- 日期、时间和数字格式化显式使用当前 i18n language，避免模块加载时锁定中文 locale。
- 数量文案使用 i18next 复数 key，避免在组件内拼接英文单复数。
- 可访问名称与可见文案使用同一资源来源，切换语言后同步更新。

## Data Flow

1. 应用启动读取语言偏好并匹配受支持语言。
2. i18n 在 React 挂载前以该语言初始化，并设置 `<html lang>`。
3. 组件从功能命名空间读取文案。
4. 用户在设置中选择语言，`changeLanguage` 触发订阅组件重渲染，同时保存偏好并更新 `<html lang>`。
5. API 数据与会话内容继续按原协议进入组件，仅外围应用文案被本地化。

## Error Handling

- `localStorage` 读取异常、JSON 损坏或版本不匹配时使用浏览器语言或 `zh-CN`。
- `localStorage` 写入异常时保留当前会话内的语言选择。
- 资源缺失时回退到 `zh-CN`；测试校验中英文资源 key 完全一致，防止 key 或错误语言泄露到界面。
- 未识别的 Codex 枚举值继续显示原始值，不猜测翻译。

## Verification Strategy

- 单元测试覆盖语言偏好解析、损坏数据回退、浏览器语言匹配、HTML `lang` 同步及资源 key 对齐。
- 组件测试覆盖设置内语言控件、中文/英文切换和官方 `Reasoning effort` 文案。
- 定向测试覆盖 Timeline/Composer/Inspector 的关键状态，同时断言 AI 输出和原始操作名称未被改写。
- 运行 `pnpm check` 与 `pnpm test:e2e`；不启动开发服务器。

## Non-Goals

- 不翻译 AI 生成内容、用户输入或外部 Provider 返回文本。
- 不增加自动翻译、服务端 locale 协商或账号级跨设备同步。
- 不添加中文、英文之外的语言，也不改动 Codex 模型和设置协议。
- 不为旧硬编码文案保留双轨兼容逻辑；迁移后的界面统一从翻译资源读取。

## Success Criteria

- 用户可在设置中即时切换 `简体中文` 与 `English`，刷新后保持选择。
- 所有应用自有的主要界面、状态、错误、通知和可访问文案随语言切换。
- 英文设置术语与 Codex 官方文档一致，AI/用户内容及规定的专有名词保持原样。
- `<html lang>`、日期与数字格式随语言正确变化。
- 中英文资源完整性测试、项目检查和端到端测试全部通过。
