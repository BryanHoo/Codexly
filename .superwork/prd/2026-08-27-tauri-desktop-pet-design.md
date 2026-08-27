# Tauri 系统桌面宠物技术方案

**状态：** 已确认  
**日期：** 2026-08-27  
**目标读者：** Codexly CLI、Server、Protocol、Web 和 Desktop 开发者

## 1. 背景

当前宠物由 `apps/web` 渲染，只能在 Codexly 工作台页面内显示。关闭浏览器、切换到其他应用或最小化工作台后，用户无法继续看到宠物和任务状态。

本方案新增独立 Tauri 桌面程序。用户仍然手动运行 `codexly start` 启动 Node 服务，Tauri 只连接已经运行的本地实例，不负责安装、启动或终止 Node 进程。宠物由透明原生窗口承载，因此可以覆盖普通桌面应用，而不再受浏览器页面边界限制。

## 2. 目标

- 使用 Tauri 2 和 Rust 提供透明、无边框、置顶的系统桌面宠物窗口。
- 连接用户已经启动的 `codexly start`，复用现有 Node Server、SQLite、宠物资源和任务状态。
- 自动发现当前本机 Codexly 实例，不要求用户手动输入端口。
- 复用现有 Canvas 动画、精灵图渲染、气泡和活动状态映射逻辑。
- 在 Node 服务退出、重启或端口变化后自动恢复连接。
- 保持现有浏览器工作台和桌面宠物可以独立启用、同时运行。
- 第一阶段支持 macOS 和 Windows，并明确多显示器与虚拟桌面边界。

## 3. 非目标

- Tauri 不内置、拉起、托管或更新 Node 服务。
- Tauri 不直接读取 Codexly SQLite、`CODEX_HOME` 或宠物资源文件。
- 不把 Node Server 改写为 Rust。
- 不让 Tauri 直接连接 Codex App Server；所有运行时数据仍通过 Codexly Server 聚合。
- 不把现有 `WorkbenchPetLayerView` 整体迁移到桌面窗口。
- 首个版本不支持远程 `--lan` 实例，也不跨设备连接。
- 首个版本不保证 Windows 宠物同时出现在所有虚拟桌面。
- 首个版本不由桌面端创建、审批或修改任务。

## 4. 关键决策

| 主题      | 决策                                                          |
| --------- | ------------------------------------------------------------- |
| 桌面技术  | 使用 Tauri 2、Rust 和系统 WebView                             |
| Node 关系 | 只连接已运行的 `codexly start`，不管理其生命周期              |
| 实例发现  | Node 写入用户私有运行时描述文件，Tauri 读取后通过健康检查确认 |
| 页面来源  | Node Server 提供独立的 `/pet.html`，Tauri 加载同源 HTTP 页面  |
| 状态来源  | Node 提供单一桌面宠物快照和可续传事件流                       |
| 原生职责  | Rust 管理窗口、托盘、显示器、单实例、自动启动和重连           |
| Web 职责  | React/Canvas 管理宠物渲染、动画、气泡和页面内交互             |
| 窗口移动  | 拖动宠物时移动原生窗口，不移动页面内 DOM Overlay              |
| 认证边界  | 仅允许回环地址，同源页面沿用现有 Server 安全策略              |
| 版本策略  | 运行时描述、健康检查和桌面协议分别携带版本                    |

## 5. 总体架构

```text
用户
  ├── codexly start --no-open
  │     └── Node Server
  │           ├── SQLite / Codex Provider
  │           ├── /v1/health
  │           ├── /v1/desktop-pet
  │           ├── /v1/desktop-pet/events
  │           ├── /v1/pets/*
  │           └── /pet.html
  │
  └── Codexly Desktop Pet
        ├── Rust/Tauri Shell
        │     ├── Runtime Discovery
        │     ├── Native Window
        │     ├── Tray / Autostart
        │     └── Reconnect Controller
        └── WebView: /pet.html
              ├── @codexly/client
              ├── Pet Activity Model
              ├── Canvas Renderer
              └── Task Bubbles
```

数据依赖方向保持为：

```text
packages/protocol
    ↓
packages/core / packages/provider-codex
    ↓
packages/server
    ↓
packages/client
    ↓
apps/web pet entry
    ↓
apps/desktop Tauri shell
```

Tauri Shell 不绕过 `packages/client` 复制 HTTP 或 WebSocket 业务协议。Rust 仅处理不适合浏览器实现的系统能力。

## 6. 用户流程

### 6.1 正常启动

1. 用户运行 `codexly start --no-open`。
2. Node Server 监听可用回环端口并写入运行时描述文件。
3. 用户启动 Codexly Desktop Pet。
4. Rust 读取描述文件，请求 `/v1/health` 并校验实例身份。
5. Rust 创建透明宠物窗口，加载 `http://127.0.0.1:<port>/pet.html`。
6. 页面获取桌面宠物快照，加载用户已选择的宠物资源。
7. 页面订阅事件流，并根据全局任务状态切换动画与气泡。

### 6.2 Node 尚未启动

- Tauri 保持托盘进程，不创建空白宠物窗口。
- 托盘状态显示“等待 Codexly 服务”。
- Rust 使用有限退避持续检查运行时描述文件。
- 用户启动 Node 后自动连接，不要求重启桌面端。

### 6.3 Node 重启

- WebView 请求或事件流断开后，Rust 隐藏宠物窗口并进入重连状态。
- Rust 重新读取描述文件，不假设端口保持不变。
- 健康检查成功且 `instanceId` 变化后，重新加载 `/pet.html`。
- 页面使用新快照恢复状态，不复用旧实例的事件序列。

## 7. Node 运行时发现协议

### 7.1 启动参数

新增 CLI 参数：

```bash
codexly start --no-open
```

`--no-open` 只禁止启动后自动打开浏览器，不改变 Server、API 或静态资源行为。未传入该参数时保持当前启动体验。

### 7.2 描述文件位置

描述文件必须位于当前用户私有运行时目录，不能放入项目目录：

| 平台    | 建议位置                                                    |
| ------- | ----------------------------------------------------------- |
| macOS   | `~/Library/Application Support/Codexly/runtime/server.json` |
| Windows | `%LOCALAPPDATA%\Codexly\runtime\server.json`                |

最终路径由 Node 与 Rust 共享的应用目录约定生成，不允许调用方自行拼接。

### 7.3 文件格式

```json
{
  "version": 1,
  "instanceId": "01K4RUNTIME8N7YQ2M5E6T9",
  "pid": 12345,
  "host": "127.0.0.1",
  "port": 3211,
  "startedAt": "2026-08-27T10:00:00.000Z"
}
```

约束：

- `version` 表示描述文件结构版本。
- `instanceId` 每次 Server 成功监听时生成，进程内保持不变。
- `host` 首个版本必须是 `127.0.0.1` 或 `localhost`，Tauri 拒绝其他地址。
- `port` 必须是实际监听端口，不能使用 CLI 请求但已被占用的端口。
- 使用临时文件加原子 Rename 写入，避免 Tauri 读取半写入 JSON。
- 文件权限限制为当前用户可读写；不得包含 Token、Cookie 或绝对项目路径。
- 正常退出时仅删除 `instanceId` 与当前进程一致的文件，避免旧进程删除新实例信息。

### 7.4 有效性校验

Tauri 不能只相信描述文件，必须依次检查：

1. JSON 结构和 `version` 是否受支持。
2. `host` 是否为允许的回环地址。
3. `pid` 是否仍存在；该检查仅用于快速排除，不作为身份依据。
4. `GET /v1/health` 是否在超时内返回成功。
5. 健康响应中的 `instanceId` 是否与描述文件一致。
6. `desktopPetProtocolVersion` 是否受当前桌面端支持。

建议健康响应扩展为：

```json
{
  "status": "ok",
  "version": 1,
  "instanceId": "01K4RUNTIME8N7YQ2M5E6T9",
  "desktopPetProtocolVersion": 1
}
```

发现描述文件过期时，Tauri 忽略它并继续等待。Tauri 不主动删除无法确认归属的描述文件。

## 8. 桌面宠物状态协议

### 8.1 为什么需要聚合接口

现有任务列表摘要不足以恢复所有任务的活动状态；项目事件连接还依赖任务快照中的 Checkpoint。让桌面端扫描全部项目、任务和快照，并为每个项目维护 WebSocket，会复制工作台运行时逻辑，连接数量也会随项目增长。

因此 Server 必须提供面向桌面宠物的只读聚合投影，作为唯一状态入口：

```text
GET /v1/desktop-pet
WS  /v1/desktop-pet/events?afterSequence=<sequence>
```

### 8.2 快照契约

建议在 `packages/protocol/src/desktop-pet.ts` 定义：

```typescript
type DesktopPetTaskBubble = Readonly<{
  attention: "none" | "waiting";
  count: number;
  directoryName: string;
  projectId: string | null;
  taskId: string;
}>;

type DesktopPetSnapshot = Readonly<{
  animationName: "idle" | "review" | "running" | "failed" | "waiting";
  bubbles: readonly DesktopPetTaskBubble[];
  checkpoint: Readonly<{
    instanceId: string;
    sequence: number;
  }>;
  pet: WorkbenchPetDescriptor | null;
  settings: WorkbenchPetSettings;
}>;
```

快照规则：

- `settings.enabled = false` 时允许 `pet = null`，桌面端隐藏窗口。
- `pet` 只返回已保存且当前可用的宠物描述，不静默切换资源。
- `animationName` 由 Server 使用统一优先级派生：`waiting > failed > running > review > idle`。
- `bubbles` 为每个活动 Task 生成独立气泡；临时任务同样显示，但不携带本地绝对路径。
- 不返回本地绝对路径；打开任务只依赖 `taskId` 和可选 `projectId`。

### 8.3 事件契约

```typescript
type DesktopPetEvent = Readonly<{
  instanceId: string;
  sequence: number;
  snapshot: DesktopPetSnapshot;
  type: "desktop-pet.updated";
}>;
```

首个版本使用完整投影事件，而不是细粒度 Patch：

- 宠物状态数据量小，完整投影更容易验证和恢复。
- Server 对连续变化执行短时间合并，避免 Token 流导致高频窗口更新。
- `sequence` 在单个 `instanceId` 内严格递增。
- 客户端重连时携带最后成功应用的 `afterSequence`。
- Server 无法续传、序列过期或 `instanceId` 不一致时，客户端重新请求快照。

建议事件发布上限为每秒 `10` 次；相同投影不重复发布。

### 8.4 打开任务

点击气泡时，页面调用 Tauri Command，由 Rust 使用系统默认浏览器打开：

```text
http://127.0.0.1:<port>/tasks/<taskId>
```

实际路由必须复用工作台已有任务 URL 生成函数。页面不能用未验证的事件字段直接拼接任意 URL，Rust 只允许打开当前已验证 Codexly Origin 下的路径。

## 9. `/pet.html` 页面

### 9.1 选择同源页面

Tauri 加载 Node 提供的 `http://127.0.0.1:<port>/pet.html`，不使用打包在 `tauri://` 下的业务页面。原因是现有 Server 对浏览器写请求和 WebSocket 执行同源 Origin 校验，宠物资源也使用 `Cross-Origin-Resource-Policy: same-origin`。

同源页面可以：

- 沿用当前 CSP、资源响应头和 WebSocket 校验。
- 直接复用 `@codexly/client`。
- 避免放宽 CORS 或允许不受控的 WebView Origin。
- 保证 Tauri 与当前 Node 版本使用匹配的页面和协议代码。

### 9.2 Vite 入口

`apps/web` 新增独立 HTML 入口和最小 React Root：

```text
apps/web/pet.html
apps/web/src/pet-main.tsx
apps/web/src/features/desktop-pet/*
```

页面只包含宠物、气泡、连接状态和原生桥接，不加载工作台路由、编辑器、侧栏或设置弹窗。构建产物由现有 Server 静态文件插件交付。

### 9.3 可复用代码

直接复用或抽取为共享纯模块：

- `workbench-pet-canvas.tsx` 的 Canvas 渲染。
- `pet-animation-controller.ts` 的帧调度和回退规则。
- `pet-renderer.ts` 的精灵图裁切。
- `pet-activity.ts` 的动画优先级；迁移后以 Protocol/Server 规则为最终来源。
- 气泡的显示模型和样式 Token。

不能直接复用：

- `WorkbenchPetLayerView` 的页面 Overlay 定位。
- 基于工作台容器尺寸的归一化位置持久化。
- 直接依赖 `ProjectRuntimeManager` 的活动状态获取。

桌面页面内的 DOM 保持固定尺寸，移动行为交给原生窗口。这样不会出现 DOM 已移动但透明窗口仍占据原位置的问题。

## 10. Tauri/Rust 设计

建议新增独立 Workspace 应用：

```text
apps/desktop/
├── package.json
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs
│       ├── runtime_discovery.rs
│       ├── connection.rs
│       ├── pet_window.rs
│       ├── tray.rs
│       ├── position_store.rs
│       └── commands.rs
└── README.md
```

各模块职责：

| 模块                   | 职责                                         |
| ---------------------- | -------------------------------------------- |
| `runtime_discovery.rs` | 定位、解析和监听运行时描述文件               |
| `connection.rs`        | 健康检查、版本协商、退避重连和连接状态机     |
| `pet_window.rs`        | 创建透明窗口、控制可见性、置顶和跨工作区行为 |
| `tray.rs`              | 展示连接状态，提供显示、隐藏、重连和退出命令 |
| `position_store.rs`    | 按显示器保存和恢复窗口位置                   |
| `commands.rs`          | 暴露拖动、点击穿透和打开任务等受限 Command   |

### 10.1 窗口配置

宠物窗口默认配置：

- 透明、无边框、无阴影、不可最大化。
- 不显示任务栏或 Dock 图标，主控制入口放在系统托盘。
- `always_on_top` 默认开启，可由托盘临时关闭。
- macOS 开启 `visible_on_all_workspaces`，显示于所有 Spaces。
- Windows 仅保证当前虚拟桌面；物理显示器切换由窗口位置逻辑处理。
- 窗口尺寸由宠物正文和气泡最大边界共同决定，并设置稳定的最小/最大值。

macOS 透明窗口需要 Tauri 的私有 API 配置，因此不能以 Mac App Store 为首个分发目标。首个版本使用签名、Notarization 和站外安装包分发。

### 10.2 拖动与点击穿透

- 宠物正文和气泡区域接收输入，透明空白区域启用点击穿透。
- 拖动开始时关闭点击穿透并调用原生窗口拖动能力。
- 拖动结束后根据可交互区域恢复点击穿透。
- 位置写入由 Rust 防抖，不能在每个 Pointer Move 同步写磁盘。
- 显示器断开或分辨率变化后，将窗口夹紧到最近可见工作区。

### 10.3 位置持久化

位置记录建议包含：

```json
{
  "displayId": "platform-display-id",
  "anchor": "bottom-right",
  "offsetX": 16,
  "offsetY": 16
}
```

优先恢复原显示器；找不到时恢复到主显示器右下角。坐标使用 Tauri 提供的逻辑坐标和缩放信息转换，避免高 DPI 下产生偏移。

### 10.4 托盘菜单

首个版本提供：

- 当前连接状态，只读显示。
- “显示宠物”或“隐藏宠物”。
- “重新连接”。
- “打开 Codexly”。
- “开机启动”开关。
- “退出桌面宠物”。

“退出桌面宠物”只退出 Tauri，不终止 `codexly start`。

## 11. 连接状态机

```text
WaitingForRuntime
        ↓ descriptor found
ValidatingRuntime
        ↓ health and version valid
Connected
        ↓ request, WebSocket, or process failure
Reconnecting
        ├── same instance restored → Connected
        ├── new instance found     → Reloading → Connected
        └── timeout                → WaitingForRuntime
```

退避建议：`250ms → 500ms → 1s → 2s → 5s`，之后保持 `5s`，并在描述文件变更时立即重试。健康请求超时建议为 `2s`。

窗口显示规则：

- `Connected` 且设置启用、资源可用时显示。
- `Connected` 但设置关闭或资源无效时隐藏。
- 其他状态隐藏窗口，托盘继续运行。
- 不显示空白 WebView、默认白色背景或过期任务状态。

## 12. 安全模型

- Tauri 只连接运行时描述文件声明的回环地址。
- 所有业务数据继续经过现有 Fastify Schema 校验和 `@codexly/client` 解码。
- `/pet.html` 只能获得桌面宠物所需的只读数据，不暴露通用文件或命令执行接口。
- Tauri Capability 只授予宠物窗口需要的窗口、托盘、自动启动和受限 Shell Open 权限。
- 打开外部地址必须校验 Origin 和允许路径，拒绝 `file://`、自定义 Scheme 和事件注入的外部 URL。
- Rust Command 使用显式参数类型，不接收任意命令名、文件路径或 Shell 参数。
- 运行时描述文件不作为认证凭据，真实实例身份必须由健康检查确认。
- 保留现有 `Cross-Origin-Resource-Policy: same-origin`，不为桌面端全局放宽 CORS。

## 13. 版本兼容

分别管理三个版本：

| 版本                         | 作用                                |
| ---------------------------- | ----------------------------------- |
| `runtime descriptor version` | Node 与 Rust 共享的实例发现文件结构 |
| `/v1/health version`         | 健康检查响应结构                    |
| `desktopPetProtocolVersion`  | 快照、事件和页面能力契约            |

Node 提供的 `/pet.html` 与 Node Server 同版本，因此页面与 API 天然同步。Rust 仍需验证 `desktopPetProtocolVersion`，因为原生 Command 和窗口能力可能与页面预期不一致。

版本不兼容时：

- 不加载宠物页面。
- 托盘显示“版本不兼容”。
- 提供打开 Codexly 发布页面或桌面端更新入口。
- 不尝试兼容未知字段语义或回退到旧事件协议。

## 14. 分阶段实施

### 阶段 1：固定端口 POC，3 至 5 个开发日

- 创建 Tauri 透明置顶窗口。
- 加载固定地址的 `/pet.html`。
- 复用 Canvas 渲染一个空闲宠物。
- 验证 macOS、Windows 的透明、拖动、置顶和多显示器表现。

退出条件：两个平台都能稳定显示非空白宠物，并且透明区域不遮挡桌面操作。

### 阶段 2：运行时发现与独立页面，3 至 4 个开发日

- 添加 `--no-open`。
- 写入并校验运行时描述文件。
- 增加独立 Vite `pet.html` 入口。
- 实现 Rust 连接状态机、托盘和重连。

退出条件：Node 使用非默认端口或重启后，桌面端无需重启即可自动恢复。

### 阶段 3：聚合状态协议，4 至 6 个开发日

- 在 Protocol、Server 和 Client 增加快照与事件契约。
- 由 Server 聚合任务活动、动画和气泡。
- 实现序列续传、事件合并和快照回退。

退出条件：多个项目和任务状态变化时，桌面宠物与工作台派生结果一致，且只维护一个事件连接。

### 阶段 4：桌面交互与可靠性，4 至 6 个开发日

- 完成窗口位置持久化、显示器恢复和点击穿透。
- 完成气泡点击、系统浏览器打开和托盘控制。
- 增加开机启动、单实例和异常恢复。

退出条件：桌面端连续运行、睡眠唤醒、显示器插拔和 Node 重启后仍能恢复合理状态。

### 阶段 5：分发与系统验收，3 至 5 个开发日

- 配置 macOS 签名与 Notarization。
- 配置 Windows 签名和安装包。
- 验证安装、升级、卸载和自动启动。
- 补齐系统级回归和发布文档。

预计 MVP 总工作量为 **14 至 21 个开发日**，不包含证书采购、外部审核等待和视觉资源调整。

## 15. 测试策略

### 15.1 Node 与 Protocol

- 运行时描述文件原子写入、正常清理和并发实例归属。
- `--no-open` 不调用浏览器打开逻辑。
- 健康检查返回实例和桌面协议版本。
- 聚合状态覆盖任务启动、等待、失败、完成和目录去重。
- 事件序列递增、重复投影去重、断线续传和序列过期回退。
- 所有新 HTTP 与 WebSocket 输入均通过 Schema 负向测试。

### 15.2 Web 页面

- 设置关闭、资源缺失和连接失败时不渲染宠物。
- 快照与事件正确驱动动画和气泡。
- WebSocket 重连后不会重复应用旧序列。
- Reduced Motion、后台可见性和 Canvas 资源清理保持现有行为。
- `/pet.html` 构建产物不引入工作台主入口的大体积依赖。

### 15.3 Rust

- 描述文件解析和回环地址校验使用单元测试。
- 连接状态机使用可控时钟和模拟健康响应测试退避。
- 新旧 `instanceId` 切换不会复用旧 Checkpoint。
- URL 打开 Command 拒绝非允许 Origin 和路径。
- 位置恢复覆盖显示器缺失、高 DPI 和可见区域夹紧。

### 15.4 系统验证

在 macOS 和 Windows 分别验证：

- Node 未启动、晚启动、异常退出和换端口重启。
- 宠物拖动、点击穿透、置顶和普通应用切换。
- 物理显示器插拔、缩放变化、睡眠与唤醒。
- 托盘退出不影响 Node，Node 退出不导致 Tauri 崩溃。
- 安装后首次启动、开机启动、升级和卸载。

## 16. 验收标准

- 用户先运行 `codexly start --no-open`，再打开桌面端即可看到已启用宠物。
- Node 自动选择其他可用端口时，用户无需配置端口。
- 宠物可显示在浏览器之外，并可拖动到任一物理显示器的可见区域。
- macOS 宠物可出现在所有 Spaces；Windows 明确只保证当前虚拟桌面。
- 所有项目的活动状态通过一个聚合事件连接驱动，无项目级连接扩散。
- Node 重启后桌面端自动恢复，期间不显示过期状态或空白窗口。
- 关闭全局宠物设置后，工作台和桌面宠物均停止显示。
- 桌面端退出、隐藏或更新不会终止 Node 服务和正在执行的任务。
- 不放宽现有同源资源策略，不新增任意 Shell、文件或 URL 打开能力。
- macOS 与 Windows 的签名安装包通过目标系统安全检查。

## 17. 风险与降级

| 风险                           | 影响                     | 处理                                              |
| ------------------------------ | ------------------------ | ------------------------------------------------- |
| macOS 透明窗口依赖私有 API     | 无法进入 Mac App Store   | 首版使用站外签名与 Notarization 分发              |
| Windows 不支持所有虚拟桌面可见 | 跨虚拟桌面体验不一致     | 首版声明当前桌面边界，后续评估平台专用实现        |
| 系统 WebView 行为差异          | 透明、缩放或输入表现不同 | POC 阶段优先完成双平台实机验证                    |
| Node 与桌面端版本不匹配        | 页面无法使用原生能力     | 强制协议协商，失败时隐藏窗口并提示更新            |
| 描述文件残留                   | 连接旧端口或错误进程     | 使用 `instanceId` 加健康检查，不信任 PID 单点判断 |
| 任务事件频率过高               | WebView 和窗口持续更新   | Server 合并投影、限频并去重                       |
| 宠物窗口遮挡桌面操作           | 影响普通应用使用         | 透明区域点击穿透，托盘提供快速隐藏                |

## 18. 后续待决项

以下事项不阻塞 POC，但必须在进入分发阶段前确认：

- 桌面应用正式产品名、Bundle Identifier 和签名主体。
- Tauri 应用是否与 npm CLI 共用版本号和发布节奏。
- 桌面端更新源、发布渠道和回滚策略。
- Windows 是否在后续版本实现跨虚拟桌面显示。
- 宠物窗口默认是否永远置顶，或将置顶作为用户设置。
- Node 未运行时是否仅保留托盘，还是增加原生系统通知。

## 19. 推荐实施顺序

先完成固定端口 POC，尽早验证透明窗口、点击穿透和系统 WebView 的平台差异。POC 通过后再落地运行时发现和聚合事件协议。不要先投入安装包、自动更新或复杂设置，因为这些工作无法降低核心窗口能力的不确定性。

正式实现应按以下行为切片进入 TDD：

1. `--no-open` 与运行时描述文件。
2. 健康检查身份和协议协商。
3. 桌面宠物快照与聚合规则。
4. 可续传事件流与 Client 解码。
5. 独立 `/pet.html` 入口。
6. Tauri 发现、窗口、托盘和重连。
7. 拖动、点击穿透、多显示器和系统分发。
