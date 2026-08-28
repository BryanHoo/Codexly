# 工作台宠物 Overlay 技术设计

**状态：** 已确认  
**日期：** 2026-08-26  
**目标读者：** Codexly 前端、协议、Provider 和 Server 开发者

## 1. 背景

OpenAI Docs 说明 Codex `/pets` 可以选择内置或自定义宠物，并由 Codex 持久化选择。Codex `0.149.0` 源码进一步表明：内置宠物按需缓存到 `CODEX_HOME`，自定义宠物由用户保存在 `CODEX_HOME/pets`。

Codexly 需要复用用户本机已有宠物资源，但保持独立产品状态：用户在 Codexly 设置中开启并选择宠物，选择结果不能修改 Codex 的 `[tui].pet`。宠物显示在工作台最高非模态层，默认位于右下角，可拖动到工作台内任意可见位置。宠物上方显示正在运行或等待用户处理的目录气泡，一个目录对应一个气泡。

参考基线：

- [OpenAI Docs: Pets](https://learn.chatgpt.com/docs/pets)
- Codex `0.149.0`：`codex-rs/tui/src/pets/asset_pack.rs`
- Codex `0.149.0`：`codex-rs/tui/src/pets/catalog.rs`
- Codex `0.149.0`：`codex-rs/tui/src/pets/model.rs`
- Codex `0.149.0`：`codex-rs/tui/src/pets/picker.rs`
- Codex `0.149.0`：`codex-rs/tui/src/pets/ambient.rs`

## 2. 目标

- 从启动 Codex App Server 时使用的同一个 `CODEX_HOME` 发现本地宠物，并按需下载内置宠物。
- 在 Codexly 设置中提供启用开关、静态预览和单选切换。
- 由 Codexly SQLite 保存启用状态和宠物选择，不读取或写入 `[tui].pet`。
- 在工作台内提供不参与布局、不阻断其他内容操作的顶层宠物 Overlay。
- 支持指针、触控和键盘移动，并在刷新后恢复合理位置。
- 复用 Codex 的精灵图、动画名称、帧序列和回退规则。
- 从现有跨项目任务活动状态派生宠物状态和目录气泡，不建立第二套任务状态源。
- 对动画、拖动、图片解码和目录气泡设置明确性能边界。

## 3. 非目标

- 不修改 `$CODEX_HOME/config.toml` 或 `[tui].pet`。
- 不在 Codexly 中上传、创建、编辑或删除自定义宠物。
- 不打包或重新分发 OpenAI 宠物图片。
- 不在开启时批量下载所有内置宠物；只下载默认或用户选中的一个。
- 不复用 Kitty、Sixel 或终端帧缓存渲染代码。
- 不让宠物覆盖模态弹窗、菜单、Toast 或系统级权限提示。
- 不为旧的 Codexly 设置契约保留并行兼容逻辑；数据库迁移后统一使用新契约。

## 4. 关键决策

| 主题       | 决策                                                                           |
| ---------- | ------------------------------------------------------------------------------ |
| 资源来源   | 自定义宠物读取本地目录；内置宠物使用本地缓存，缺失时从 Codex `v1` CDN 按需下载 |
| 内置目录   | `$CODEX_HOME/cache/tui-pets/v1/assets`                                         |
| 自定义目录 | `$CODEX_HOME/pets/<pet-id>/pet.json`                                           |
| 旧版目录   | `$CODEX_HOME/avatars/<pet-id>/avatar.json`，同 ID 时由 `pets` 覆盖             |
| 选择持久化 | 扩展 Codexly `AgentGlobalSettings` 和 SQLite `global_settings`                 |
| 位置持久化 | 使用浏览器 `localStorage` 保存归一化坐标，避免跨视口共享像素坐标               |
| 渲染方式   | 单个 `<canvas>` 绘制选中精灵图的当前帧，不拆分 PNG                             |
| 拖动方式   | 外层只写合成层 `transform`，每个动画帧最多提交一次位置                         |
| 活动来源   | 复用 `ProjectRuntimeManager` 的 `TaskActivityMap` 和 `Project` 数据            |
| 气泡聚合   | 每个实际运行目录一个气泡，同目录多个 Task 聚合数量                             |
| 层级       | 工作台最高非模态层；Radix Dialog 等模态层继续位于其上                          |

## 5. 用户体验

### 5.1 设置

全局设置增加“宠物”区段：

1. “启用宠物”开关默认关闭。
2. 打开区段时请求宠物目录；所有内置宠物均可选择，自定义宠物来自本地目录。
3. `ready` 宠物显示名称、来源和第一张 `idle` 帧的静态缩略图；`downloadable` 内置宠物显示下载状态，不提前请求图片。
4. 只有当前选中且已经 `ready` 的预览可以播放动画，列表内其他缩略图保持静止。
5. 开启宠物且尚未选择时，自动选择内置 `codex` 并开始下载；已经缓存时直接复用。
6. 切换到其他未缓存的内置宠物时，只下载该宠物，不预取其余资源。
7. 下载完成后才允许保存启用状态；取消设置不启用宠物，但允许保留已经完成的缓存文件。
8. 保存后立即更新工作台；取消或保存失败不得改变当前宠物。
9. 提供“刷新列表”命令，用于用户手动添加自定义资源后的重新扫描。

若已保存的宠物资源被移除，保留 `selectedPetId`，隐藏工作台宠物，并在设置中显示资源不可用状态。不得静默切换到另一只宠物。

### 5.2 工作台

- 首次启用时，宠物正文距工作台右侧和底部各 `16px`，并考虑 `env(safe-area-inset-*)`。
- 宠物可以在工作台可见边界内拖动，位置不受侧栏和 Inspector 网格布局影响。
- Overlay 空白区域使用 `pointer-events: none`，只有宠物拖动目标和可滚动气泡区域接收事件。
- 宠物正文默认高度为 `80px`，窄屏为 `64px`，保持帧宽高比。
- 指针悬停显示拖动光标；拖动期间使用 `grabbing`。
- 键盘聚焦宠物后，方向键每次移动 `8px`，`Shift` 加方向键每次移动 `24px`，`Home` 恢复右下角。
- 设置弹窗、菜单和其他模态层打开时仍位于宠物之上。

### 5.3 目录气泡

- 气泡默认垂直排列在宠物上方，每个唯一运行目录一个气泡。
- 同目录多个活动 Task 合并为一个气泡并显示数量，例如 `Codexly · 3`。
- 气泡正文只显示目录末级名称；完整路径仅在本地模式 Tooltip 中显示。
- 当某 Task 等待审批或输入时，对应气泡显示等待状态；其余运行目录显示运行状态。
- Task 完成、失败或取消后，该目录没有其他活动 Task 时立即移除气泡。
- 气泡区域最高为 `40dvh`，数量较多时内部滚动，不折叠成单个汇总气泡。
- 宠物靠近顶部导致空间不足时，气泡区域临时翻转到宠物下方；其余位置始终显示在顶部。

临时任务没有用户目录，但按其他活动 Task 创建独立气泡且不显示路径 Tooltip。

## 6. Codex 资源契约

### 6.1 内置资源

Codex `0.149.0` 的内置资源不是完整安装包，而是按需写入：

```text
$CODEX_HOME/cache/tui-pets/v1/assets/<spritesheet-file>.webp
```

Codexly 内置与 `0.149.0` 对齐的只读元数据目录。所有已知内置宠物都进入可选列表，并通过 `availability` 区分 `ready` 与 `downloadable`。开启开关且没有既有选择时，使用 Codex 的 `DEFAULT_PET_ID = "codex"`，自动下载并缓存对应精灵图；切换其他未缓存内置宠物时同样按需下载。未知文件不得自动暴露，因为其中没有可信动画元数据。

下载行为与 Codex `asset_pack.rs` 对齐：

```text
base URL: https://persistent.oaistatic.com/codex/pets/v1
timeout:  60s
max size: 4MiB
install:  temporary file + validate + atomic rename
```

同一宠物的并发下载共享一个 in-flight Promise；全局下载并发上限为 `2`。命中有效缓存时不得发起网络请求。下载失败不写设置、不留下临时文件，也不影响自定义宠物选择。

内置精灵图约束：

```text
spritesheet: 1536x1872
frame:       192x208
columns:     8
rows:        9
frames:      72
format:      WebP
```

### 6.2 自定义资源

首选结构：

```text
$CODEX_HOME/pets/chefito/
├── pet.json
└── spritesheet.webp | spritesheet.png
```

旧版结构：

```text
$CODEX_HOME/avatars/chefito/
├── avatar.json
└── spritesheet.webp | spritesheet.png
```

服务端解析以下字段并输出规范化结果：

```json
{
  "id": "chefito",
  "displayName": "Chefito",
  "description": "",
  "spriteVersionNumber": 2,
  "spritesheetPath": "spritesheet.webp",
  "frame": {
    "width": 192,
    "height": 208,
    "columns": 8,
    "rows": 11
  },
  "animations": {}
}
```

v1 规则与 Codex `0.149.0` 的 `model.rs` 对齐；同时接受桌面端生成的 v2 清单：

- 目录选择器使用 `custom:<folder-name>`，不使用 Manifest 内的 `id` 作为文件路径。
- `spritesheetPath` 必须是宠物目录内的相对路径。
- `spriteVersionNumber` 缺省或为 `1` 时，`frame` 缺省使用 `192x208`、`8x9`，图集尺寸为 `1536x1872`。
- `spriteVersionNumber` 为 `2` 时，`frame` 缺省使用 `192x208`、`8x11`，图集尺寸为 `1536x2288`；工作台使用前 9 行标准状态，保留后 2 行方向帧。
- 自定义精灵图接受 PNG 或 WebP；内置 CDN 下载仍严格限定 WebP。
- `animations` 为空时使用 Codex 默认动画；非空时覆盖同名默认动画。
- 帧索引必须小于 `frame_count`，动画 FPS 必须大于 `0` 且不超过 `60`。
- `pets` 与 `avatars` 同名时只返回 `pets`。

### 6.3 文件安全

资源发现和发送必须在 Node 后端完成，浏览器不得使用 `file://` 或直接访问用户目录。

- Manifest 最大 `64KiB`；自定义精灵图最大 `16MiB`，内置下载严格使用 Codex 的 `4MiB` 上限。
- 使用成熟图片解析库读取 PNG/WebP 类型和尺寸，不手写二进制格式解析器。
- 对目录和精灵图执行 `realpath`，确认真实路径仍位于对应宠物目录或内置缓存目录。
- 拒绝绝对路径、`..`、符号链接逃逸、非普通文件和无效图片。
- 资源请求根据服务端发现出的 `assetId` 反查文件，不把 URL 参数直接拼接为路径。
- 每次发送资源前重新解析并校验，避免扫描与读取之间的文件替换。
- 响应按实际资源设置 `Content-Type: image/png | image/webp`，并设置 `X-Content-Type-Options: nosniff` 和 `Cross-Origin-Resource-Policy: same-origin`。
- 使用文件大小和 `mtimeMs` 生成弱 `ETag`，允许浏览器条件请求；不得公开本地绝对路径。

下载接口还必须满足：

- 只接收宠物 ID，不接收 URL、文件名或目标路径。
- 文件名只来自编译期内置目录，目标目录固定为 `$CODEX_HOME/cache/tui-pets/v1/assets`。
- 流式读取响应并在超过 `4MiB` 时立即中止，不能先完整缓冲超限响应。
- 临时文件名使用不可预测后缀；验证失败、请求取消和进程退出时清理临时文件。
- 安装前验证 WebP 尺寸为 `1536x1872`，成功后使用同目录原子 Rename。

### 6.4 版本与分发边界

Codexly 不把官方 WebP 放入安装包，只在用户启用或选择内置宠物时执行与 Codex TUI 相同的运行时下载。OpenAI Docs 没有把该 CDN 路径声明为稳定公共资源 API，因此 `PET_PACK_VERSION`、文件目录和 `SUPPORTED_CODEX_VERSION` 必须一起评审和升级。CDN 不可用时功能降级，不能阻断 Codexly 启动或任务执行。

## 7. 跨层架构

数据流保持现有依赖方向：

```text
packages/protocol
    ↓
packages/core
    ↓
packages/provider-codex
    ↓
packages/server
    ↓
packages/client
    ↓
apps/web/src/features/pets
```

### 7.1 协议层

新增 `packages/protocol/src/workbench-pets.ts`：

```typescript
type WorkbenchPetSettings = Readonly<{
  enabled: boolean;
  selectedPetId: string | null;
}>;

type WorkbenchPetFrame = Readonly<{
  columns: number;
  height: number;
  rows: number;
  width: number;
}>;

type WorkbenchPetAnimationFrame = Readonly<{
  durationMs: number;
  spriteIndex: number;
}>;

type WorkbenchPetAnimation = Readonly<{
  fallback: string;
  frames: readonly WorkbenchPetAnimationFrame[];
  loopStart: number | null;
}>;

type WorkbenchPetDescriptor = Readonly<{
  animations: Readonly<Record<string, WorkbenchPetAnimation>>;
  assetId: string;
  availability: "downloadable" | "ready";
  description: string;
  displayName: string;
  frame: WorkbenchPetFrame;
  id: string;
  source: "builtin" | "custom" | "legacy";
}>;

type WorkbenchPetCatalogResponse = Readonly<{
  data: readonly WorkbenchPetDescriptor[];
}>;
```

`AgentGlobalSettingsSchema` 增加必填 `pet: WorkbenchPetSettingsSchema`。首次迁移默认：

```json
{
  "enabled": false,
  "selectedPetId": null
}
```

### 7.2 Core 与 Provider

`packages/core` 新增只读端口：

```typescript
interface WorkbenchPetProvider {
  ensurePetAsset(petId: string): Promise<WorkbenchPetDescriptor>;
  listPets(): Promise<readonly WorkbenchPetDescriptor[]>;
  openPetAsset(assetId: string): Promise<WorkbenchPetAsset | undefined>;
}
```

`packages/provider-codex` 实现该端口，并由 CLI 注入已经解析的 `codexHome` 和可测试的 HTTP Fetch 依赖。该实现拥有 Codex 目录、Manifest、CDN 和默认动画知识；Server 不直接依赖 Codex 文件结构。

目录列表不使用常驻 `fs.watch`。设置页打开、用户刷新、恢复已选宠物或请求资源时按需扫描，避免长期文件监听和跨平台差异。

### 7.3 Server 与 Client

新增接口：

```text
GET /v1/pets
GET /v1/pets/assets/:assetId
POST /v1/pets/downloads
```

- `GET /v1/pets` 返回全部已知内置宠物及当前有效自定义目录，不返回路径。
- `GET /v1/pets/assets/:assetId` 返回经过重新校验的 PNG 或 WebP。
- `POST /v1/pets/downloads` 接收 `{ "petId": "codex" }`，只允许下载内置目录白名单中的 ID，并返回 `ready` Descriptor。
- 三个接口复用现有访问控制；LAN 模式不得绕过认证；下载 Mutation 使用 `idempotency-key`。
- `assetId` 使用服务端生成的稳定 SHA-256 标识，不能由客户端解释为文件路径。
- 下载 URL 只能由固定 HTTPS Base URL 和白名单文件名组成；重定向后的最终 URL 必须仍为 HTTPS 且 Host 属于 OpenAI 静态资源白名单。
- 资源不存在或扫描后失效返回 `404`，无效资源返回 `422`，下载失败返回 `502`，后端读取失败返回 `500`。

`packages/client` 负责 TypeBox 解码和统一错误映射。Web 只能通过 `@codexly/client` 与 `@codexly/protocol` 访问宠物契约。

### 7.4 SQLite 设置

`global_settings` 增加：

```sql
pet_enabled INTEGER NOT NULL DEFAULT 0 CHECK (pet_enabled IN (0, 1));
pet_id TEXT;
```

读取时规范化为 `AgentGlobalSettings.pet`，写入时与其他全局设置同事务完整替换。业务校验要求：

- `enabled = false` 时允许 `selectedPetId = null` 或保留已失效 ID。
- `enabled = true` 时 `selectedPetId` 必须非空；资源可用性在目录和渲染阶段判断，避免失效资源阻塞其他全局设置保存。
- 更新只写 Codexly 的 `$CODEX_HOME/codexly/state.sqlite3`，不得调用 Codex config edit API。

## 8. 前端模块

新增功能目录：

```text
apps/web/src/features/pets/
├── components/
│   ├── workbench-pet-layer.tsx
│   ├── workbench-pet-canvas.tsx
│   ├── workbench-pet-bubbles.tsx
│   └── global-settings-pets.tsx
├── pet-activity.ts
├── pet-animation-controller.ts
├── pet-catalog-query.ts
├── pet-position-preference.ts
└── pet-renderer.ts
```

`workbench-shell-layout.tsx` 已接近单文件长度限制，只负责挂载 `<WorkbenchPetLayer />`。设置主组件同样只接入 `<GlobalSettingsPets />`，不能继续堆积宠物业务逻辑。

### 8.1 Overlay 层

`WorkbenchPetLayer` 作为 `.workbench-shell` 最后一个非模态子节点：

```text
.workbench-shell
├── sidebar / main / inspector
├── panel resizers
├── workbench-pet-layer       z-index: 46
└── dialogs via body portal   z-index: 50+
```

根层使用 `position: absolute; inset: 0; pointer-events: none; contain: layout style paint`。宠物定位容器单独启用 `pointer-events: auto` 和 `will-change: transform`。`z-index: 46` 高于当前时间线导航 `45`，低于 Dialog `50`。

### 8.2 位置模型

位置只属于当前浏览器和视口，使用：

```text
localStorage key: codexly.workbench-pet-position
value: { "version": 1, "xRatio": 1, "yRatio": 1 }
```

`xRatio` 和 `yRatio` 表示宠物正文在可移动范围内的位置比例，而不是原始像素。恢复流程：

1. 读取并校验版本和 `[0, 1]` 范围。
2. 根据工作台尺寸、宠物尺寸和安全边距计算当前可移动范围。
3. 比例换算为像素并限制在可见边界。
4. 未保存或数据损坏时使用 `(1, 1)`，即右下角。

使用 `ResizeObserver` 监听工作台边界变化，仅在尺寸确实改变时重新限制位置。不得持续读取布局。

### 8.3 拖动

拖动使用 Pointer Events：

1. `pointerdown` 时记录起点、当前位置和工作台边界，并调用 `setPointerCapture`。
2. `pointermove` 只更新内存中的待提交坐标。
3. 通过单个 `requestAnimationFrame` 写入 `transform: translate3d(...)`。
4. 拖动期间不得调用 React `setState`，不得重复执行 `getBoundingClientRect()`。
5. `pointerup`、`pointercancel` 或组件卸载时释放捕获、取消 RAF，并提交一次 React 状态和 `localStorage`。

拖动方向首次跨过阈值时切换到 `running-left` 或 `running-right`，不随每个像素重复切换。释放后播放一次 `jumping`，再恢复任务派生状态；缺少对应动画时按 Manifest `fallback` 回退。

## 9. 动画系统

### 9.1 渲染

选中宠物只创建一个图片解码结果和一个 `<canvas>`：

- 使用 `createImageBitmap` 解码同源 PNG 或 WebP。
- Canvas 显示尺寸与宠物正文一致，内部按 `devicePixelRatio` 设置像素尺寸。
- 每帧通过 `drawImage` 的源矩形直接裁切精灵图。
- 切换宠物或卸载时调用 `ImageBitmap.close()`。
- 不把 72 帧拆成独立 Blob、Data URL 或 DOM 节点。

### 9.2 调度

- 使用单个 `setTimeout` 按当前帧 `durationMs` 调度，不运行永久 `60fps` RAF 动画循环。
- 只有拖动位置更新使用 RAF。
- `document.visibilityState !== "visible"` 时取消动画 Timer；恢复可见时从当前状态第一帧重新播放。
- `prefers-reduced-motion: reduce` 时固定显示当前动画的第一帧，不安排后续 Timer。
- 动画切换使用递增 generation 标记，过期 Timer 不得提交帧。
- 解码失败、Canvas Context 丢失或动画非法时隐藏宠物并保留设置错误状态，不影响工作台。

### 9.3 默认动画

默认动画与 Codex `0.149.0` 对齐：

| 名称            | 精灵图行 | 有效帧 | 用途               |
| --------------- | -------: | -----: | ------------------ |
| `idle`          |        0 |      6 | 空闲               |
| `running-right` |        1 |      8 | 向右拖动           |
| `running-left`  |        2 |      8 | 向左拖动           |
| `waving`        |        3 |      4 | 可选交互反馈       |
| `jumping`       |        4 |      5 | 放下反馈           |
| `failed`        |        5 |      8 | 失败               |
| `waiting`       |        6 |      6 | 等待用户输入或审批 |
| `running`       |        7 |      6 | 任务运行           |
| `review`        |        8 |      6 | 任务完成、等待查看 |

必须保留 Codex 的逐帧时长、循环起点和 `fallback`，不能把 `idle` 简化为等时长 CSS `steps()`。

## 10. 任务状态与气泡

### 10.1 状态来源

不得新增全局 WebSocket 订阅。`ProjectProvider` 已通过 `useSyncExternalStore` 发布 `TaskActivityMap`，宠物功能新增纯选择器，将其与 `projects` 合并：

```typescript
type WorkbenchPetDirectoryActivity = Readonly<{
  activeTaskCount: number;
  directoryName: string;
  projectId: string;
  rootPath?: string;
  status: "running" | "waiting";
}>;
```

目录解析规则：

- 普通项目使用 `project.roots[0].path`，它与当前 Provider 的 Task `cwd` 一致。
- 以规范化路径聚合；Windows 路径比较忽略大小写。
- 同目录任一 Task 等待审批时，目录状态为 `waiting`，否则为 `running`。
- 临时任务按相同状态规则产生独立气泡，但不提供 `rootPath`。

若未来协议给 `AgentTask` 增加实际 `cwd`，应直接使用该字段替换项目主目录推导，不能同时保留两套路径来源。

### 10.2 宠物状态优先级

多 Task 并发时使用确定性优先级：

```text
drag interaction
  > waiting
  > failed
  > running
  > review
  > idle
```

- `waiting`：任一 Task 存在待审批或待输入请求。
- `failed`：任一未查看 Task 的 `attention === "failed"`。
- `running`：任一 Task 正在运行。
- `review`：任一未查看 Task 的 `attention === "completed"`。
- `idle`：不存在以上状态。

任务动画按 Codex 动画自身的循环和 `fallback` 执行。气泡仅表示当前活动目录，不因历史 `failed` 或 `review` 状态继续保留。

## 11. 性能预算

### 11.1 强制约束

- 空闲动画平均绘制频率不得超过其真实帧时长要求；运行动画不超过 `10fps`。
- 指针移动每个浏览器帧最多执行一次样式写入。
- 指针移动期间 React 组件不得重新渲染。
- 动画帧更新只重绘 Canvas，不触发工作台布局。
- Overlay 的布局变化不得改变 sidebar、timeline、composer 或 inspector 的尺寸。
- 只解码当前选中的精灵图；设置列表不得同时解码所有完整动画。
- 不创建文件轮询、常驻文件 Watcher 或每 Task 独立 Timer。
- 所有 Timer、RAF、`ResizeObserver`、媒体查询监听器和 Pointer Capture 必须在卸载时释放。

### 11.2 观测指标

实现完成后以 Chromium Performance 和现有 `pnpm run test:performance` 验证：

- 非拖动状态不出现持续 `60fps` JavaScript 调度。
- 连续拖动 `10s` 不产生长于 `50ms` 的宠物脚本 Long Task。
- 拖动期间工作台 `CLS = 0`。
- 选中资源之外不保留其他 `ImageBitmap`。
- `32` 个目录气泡时，任务事件更新只触发宠物层重渲染，不触发时间线重渲染。
- 页面后台停留 `60s` 时没有宠物动画帧提交。

## 12. 可访问性与响应式

- 宠物 Canvas 设置 `aria-hidden="true"`，可拖动容器使用可访问名称描述当前宠物和移动方式。
- 气泡列表使用一个 `aria-live="polite"` 摘要，仅在目录集合或等待状态变化时更新，动画帧不得触发读屏通知。
- 拖动目标最小触控尺寸为 `44x44px`，设置 `touch-action: none` 只作用于宠物本体。
- 窄屏下宠物仍限制在工作台边界内，不覆盖系统安全区域。
- `prefers-reduced-motion` 关闭动画但不关闭宠物、气泡或拖动。
- 高对比度模式下气泡使用现有语义颜色和边框 Token，不依赖透明阴影表达状态。

## 13. 错误与降级

| 场景                  | 行为                                               |
| --------------------- | -------------------------------------------------- |
| `CODEX_HOME` 不可读   | 宠物目录为空，设置显示读取错误，工作台正常运行     |
| 默认内置宠物未缓存    | 开启后自动下载 `codex`，完成前禁用保存             |
| 默认内置宠物下载失败  | 保持设置草稿且不启用，允许重试或选择本地自定义宠物 |
| 已选资源被删除        | 隐藏宠物，保留选择并允许刷新或重新选择             |
| Manifest 无效         | 跳过该宠物并记录不含绝对路径的诊断日志             |
| 精灵图加载失败        | 当前会话隐藏宠物，不影响其他工作台组件             |
| Canvas 不可用         | 显示第一帧静态 `<img>` 裁切回退；仍不可用则隐藏    |
| `localStorage` 不可用 | 当前会话允许拖动，但刷新后恢复右下角               |
| 动画名称缺失          | 按 Manifest `fallback`，最终回退到 `idle` 第一帧   |
| WebSocket 重连        | 使用恢复后的 `TaskActivityMap` 重新派生状态和气泡  |

## 14. 测试设计

### 14.1 Provider

- 发现有效内置缓存、自定义宠物和旧版 Avatar。
- 未缓存内置宠物返回 `downloadable`，有效缓存返回 `ready`。
- 首次下载使用 `4MiB`、`60s`、尺寸校验和原子安装规则。
- 同 ID 并发下载复用请求，不同 ID 下载并发不超过 `2`。
- 验证 `pets` 覆盖同名 `avatars`。
- 跳过缺失、超限、维度错误、非法动画和路径逃逸资源。
- 验证未知内置 WebP 不进入目录。
- 验证 `assetId` 不能用于读取目录外文件。

### 14.2 Protocol、Server 与 Client

- TypeBox 接受完整目录和设置，拒绝额外字段、非法帧和非法设置组合。
- SQLite Migration 默认关闭宠物，并在重启后恢复完整设置。
- `PUT /v1/settings` 不写入 `config.toml`。
- 目录、资源和下载接口在本地及 LAN 认证模式下遵守访问控制。
- 下载接口拒绝自定义 ID、未知 ID、任意 URL 和无 `idempotency-key` 请求。
- 验证 `ETag`、`304`、`404`、`422`、`502` 和安全响应头。
- Client 对目录响应执行协议解码。

### 14.3 Web 单元与组件测试

- 打开开关时默认选择并下载 `codex`；下载完成前不提交启用状态。
- 设置草稿仅在资源准备和保存均成功后应用。
- 位置损坏时回退右下角；视口变化时归一化并限制边界。
- Pointer Events 每帧只提交一次 Transform，结束时只持久化一次。
- `visibilitychange`、Reduced Motion 和卸载会清理调度器。
- 动画控制器执行逐帧时长、循环起点和 `fallback`。
- 多项目 Task 正确生成多个气泡；同目录 Task 正确聚合数量。
- 状态优先级符合 `waiting > failed > running > review > idle`。

### 14.4 E2E

- 用户在设置中首次启用宠物时自动下载 `codex`，保存后右下角出现宠物。
- 切换到另一个未缓存内置宠物时只下载该宠物。
- 刷新页面后恢复宠物选择和拖动位置。
- 宠物可拖到四个边界，不导致 Timeline、Composer 或 Inspector 位移。
- 两个项目同时运行时显示两个目录气泡；其中一个等待审批时只更新对应气泡。
- 打开设置 Dialog 后 Dialog 始终位于宠物之上。
- `prefers-reduced-motion` 下宠物静止但可拖动。

## 15. 验收条件

- 宠物关闭且未打开设置时不请求目录、不解码图片、不创建动画 Timer。
- 首次开启自动选择并下载 `codex`；切换内置宠物时只按需下载目标资源。
- 自定义宠物只显示用户当前 `CODEX_HOME` 中有效且已存在的资源。
- Codexly 重启后恢复启用状态和选择，且 `$CODEX_HOME/config.toml` 内容不变。
- 浏览器刷新后恢复拖动位置；视口尺寸变化后宠物仍完全可见。
- 任意工作台内容仍可正常点击、滚动、选择文本和调整面板。
- 多目录并发活动时，每个目录都有独立气泡，同目录显示聚合数量。
- 动画、拖动和气泡更新满足第 11 节性能预算。
- 所有新增协议、数据库、Provider、Client、Web 和 E2E 测试通过。
- `pnpm run format:check`、`pnpm run lint`、`pnpm run lint:architecture`、`pnpm run typecheck` 和相关测试通过。

## 16. 实施顺序

1. 定义 `WorkbenchPet` 协议、Core 端口和 Codex Provider 资源发现/下载。
2. 增加 Server 目录/资源/下载接口、SQLite Migration 和 Client 方法。
3. 拆分设置宠物区段，完成启用、选择、刷新和错误状态。
4. 实现 Canvas 动画控制器、Overlay 和位置持久化。
5. 从 `TaskActivityMap` 派生动画状态及目录气泡。
6. 补齐性能、可访问性、单元、集成和 E2E 验证。
