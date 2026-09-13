# 前端状态管理

## Purpose

Track where local, shared, and remote state should live in this project.

## 状态归属

- 临时交互状态默认留在组件或最近的功能 Hook 中。
- HTTP 服务端状态使用 TanStack Query；查询 key 和 mutation 行为集中在对应功能模块。
- 任务看板已完成列表每页仅调用一次 `queryCompletedTasks`，传递选中作用域和上次 `nextCursor`；前端不分配各项目分页容量、不并发请求各 Provider 页，也不判断各作用域是否耗尽。分页后的缓存展示仍可合并已收到的任务与实时完成事件。
- 搜索源和置顶列表通过单次 `listTaskCatalog` 读取各作用域完整目录，浏览器不得遍历 Provider 游标或重复去重；保留 Query 取消信号、现有缓存失效和输入过滤。普通最近任务仍按用户操作逐页加载。
- 非阻塞异步问题的身份、待回答/关闭状态和答案格式由后端管理；前端只保留选择、草稿、折叠等交互状态，提交问题 ID 与答案数组，不按用户消息文本推断回答、不使用 localStorage 保存关闭状态。未知投递结果必须禁用重复发送。升级前仅存在浏览器中的旧关闭记录不导入，历史问题可重新显示，由用户按新接口关闭。
- 正式项目待办通过 `/v1/projects/:projectId/todos` 存取，TanStack Query 是前端唯一正式数据源；未保存编辑副本保留在组件侧 Store，固定编辑起点版本，不能因后台刷新推进 `expectedVersion`。仅在服务器确认成功后更新列表或移除待办。
- 首次读取待办时，一次性导入当前浏览器的旧待办（优先保留最新编辑内容）；只有后端确认后才标记完成，保留旧记录作为备份。导入以原始 ID 去重，不覆盖已有正式数据；附件失效等失败必须提示并保留原数据，刷新后可重试。迁移逻辑不作为第二套正式存储。
- 普通提交与评审使用单次 `submitTask` 意图请求，由后端创建 Task、保存设置、启动 Turn 并返回 checkpoint；前端仅保持请求幂等 Key、输入草稿及渲染状态，不再串联 Task 创建和 Turn 启动。
- 已有正式 Task 修改模型、推理强度、审批或沙盒设置时，只调用一次 `updateTaskSettingsAndDefaults`；前端不得并发写 Task 设置和 Project 默认值。成功后分别用响应中的 `settings` 更新运行时 Store、用 `defaults` 更新 Query 缓存。仅切换快速模式仍只更新 Project 默认值；临时 Task 不持久化 Project 默认值。
- 队列项“立即发送”仅提交队列 ID 到 `/queue/start`，不根据浏览器的活动 Turn 决定 start/steer，也不在成功后另行删除队列项。前端只更新队列查询与等待回显状态；浏览器回归必须断言一次发送仅产生一个写请求。
- Composer Queue 通过一次 GET `/queue` 获取完整列表；Node 不对已完整载入内存的持久队列再次分页，浏览器不得循环 cursor/limit 聚合。
- 终止后台终端时，前端直接用 mutation 响应中的 `terminals` 更新对应 Query cache，不在成功后追加列表 GET；失败时保留原列表供重试。
- Provider 连接 mutation 返回的 `status` 必须直接写入连接缓存，自定义 Provider 返回的 `models` 必须直接写入模型缓存；前端不得为响应已覆盖的数据追加 GET，只失效刷新未包含的设置与 Project 默认值。
- 保存编辑后的队列项只发送一次更新请求；空闲检测、队首恢复及编辑屏障由 Node 处理。前端不得在更新成功后追加 `/queue/start`，也不将更新响应作为剩余队列列表。
- “删除全部归档任务”确认后仅调用一次 `deleteArchivedTasks`；浏览器不得遍历分页或逐项删除。部分失败显示服务端返回的数量并保留确认弹窗，完成后刷新列表；浏览器回归需验证搜索过滤不缩小批量操作范围，且一次确认只有一次批量写请求。
- 定时任务页面按最近到期时间刷新等待状态，到期或运行期间继续轮询；编辑未变更的调度字段必须保留完整 RRULE、原始时区和时间精度，仅完整匹配的规则可识别为预设。
- 打开定时任务 Run 时只调用一次 `readNavigableTask`；Task 缺失、归档分区遍历和分页停滞判断由 Node 处理。前端只缓存非空快照并导航，不匹配 Provider 错误文本，也不遍历归档分页。
- 项目、访问控制和编辑器草稿等跨组件状态使用现有 Context；不要新增重复的全局状态源。
- Agent 事件、快照和重放状态保持在 `features/conversation/runtime` 的专用 store 中，并遵守现有内存上限。
- 消息去重只消费 Node 提供的规范 ID 与 `identityAliases`，别名替换必须保留原渲染位置并清理旧 Store 项；事件会话 ID 改变时使用新快照，不能将旧会话消息身份混入新状态。乐观用户消息仅按所属 Turn 的占位 ID 替换。
- Skill 消息的合并、去重与正文前缀清理由 Node Provider 完成；前端按消息 ID 替换完整内容，不依据相邻用户项或空正文猜测 Skill 展开关系。
- 持久化偏好继续使用对应功能已有的浏览器存储适配器。
- 主题、背景和宠物偏好通过 `shared/lib/browser-storage.ts` 获取本地存储；获取属性与读写方法均须保护，禁用存储时回退默认值且不阻断启动或当前页面交互。回归测试同时覆盖 getter 抛出 `SecurityError` 和读写方法抛错。
- 应用更新进度作为 HTTP 服务端状态交给 TanStack Query；仅在更新 mutation 活跃时轮询独立进度端点，空闲后停止轮询，不在组件中维护重复定时器。
