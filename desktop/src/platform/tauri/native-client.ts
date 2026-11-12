import { connectCodexRuntime, ensureCodexRuntime, subscribeAgentEvents } from "./runtime.js";
import { invoke, type NativeInvoke } from "./native-invoke.js";
import { requiresLegacyTaskRuntime, AcpLegacyTaskCommandError } from "./task-command-boundary.js";
import { v4 as createUuid } from "uuid";

export type InvokeImplementation = NativeInvoke;

export type TauriClientOptions = Readonly<{
  connectEvents?: () => Promise<unknown>;
  ensureRuntime?: () => Promise<unknown>;
  invoke?: InvokeImplementation;
  subscribeAgentEvents?: typeof subscribeAgentEvents;
}>;

export class NativeCommandError extends Error {
  public readonly code: string;
  public readonly rpcCode: number | null;

  public constructor(code: string, message: string, rpcCode: number | null = null) {
    super(message);
    this.name = "NativeCommandError";
    this.code = code;
    this.rpcCode = rpcCode;
  }
}

export function normalizeNativeError(error: unknown): unknown {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    const rpcCode = "rpcCode" in error && typeof error.rpcCode === "number" ? error.rpcCode : null;
    return new NativeCommandError(error.code, error.message, rpcCode);
  }
  // Tauri 参数校验等框架错误以字符串拒绝，统一包装后保留原始诊断信息。
  if (typeof error === "string" && error.trim().length > 0) return new Error(error);
  return error;
}

// 本地目录及按任务分流的命令只需要事件通道，不能让缺失 Codex 阻断 Claude。
const engineIndependentCommands = new Set(["acp_task_request", "list_projects", "add_project", "remove_project", "rename_project", "reorder_projects", "list_tasks", "list_completed_tasks", "read_task", "start_task", "start_turn", "submit_prompt", "interrupt_turn", "stop_task_session", "resolve_pending_request", "get_task_settings", "update_task_settings", "retain_task_subscription", "release_task_subscription", "rename_task", "pin_task", "archive_task", "unarchive_task", "delete_task"]);

// 文件、Git 与应用工具由 Rust 本地服务执行，不依赖任何模型进程或模型事件订阅。
const localCommands = new Set([
  "application_preferences_request", "optimize_prompt",
  "acp_plan_request", "acp_agent_request", "read_acp_agent", "create_acp_task", "read_acp_scheduled_config", "set_acp_scheduled_config",
  "list_host_files", "upload_attachment", "import_host_attachment", "cache_project_image",
  "get_project_pdf_file", "open_project", "list_project_files", "search_project_files",
  "stop_project_file_search", "read_project_source_file", "save_project_text_file",
  "rename_project_file", "delete_project_file", "get_project_git_status", "get_project_git_history",
  "get_project_git_commit_files", "get_project_git_commit_file_diff", "switch_project_branch",
  "create_project_branch", "list_project_worktrees", "create_task_worktree", "discard_project_changes", "commit_project_changes",
  "push_project_commits", "get_runtime_performance_metrics", "install_app_update",
  "list_workbench_pets", "download_workbench_pet", "start_worktree_task",
]);

function isLocalCommand(command: string, args?: Record<string, unknown>): boolean {
  return localCommands.has(command) || (command === "generate_commit_message" && args?.["agentRuntime"] === "acp");
}

export class TauriNativeClient {
  /** 子类从静态能力选择交付链路，不通过模型连接猜测运行时。 */
  protected applicationRuntime(): Promise<"legacy" | "acp"> { return Promise.resolve("legacy"); }

  protected readonly connectRuntime: () => Promise<unknown>;
  protected readonly ensureRuntime: () => Promise<unknown>;
  protected readonly invokeNative: InvokeImplementation;
  protected readonly subscribeNativeEvents: typeof subscribeAgentEvents;
  protected readonly taskProjects = new Map<string, string>();

  public constructor(options: TauriClientOptions = {}) {
    this.ensureRuntime = options.ensureRuntime ?? ensureCodexRuntime;
    this.connectRuntime = options.connectEvents ?? options.ensureRuntime ?? connectCodexRuntime;
    this.invokeNative = options.invoke ?? invoke;
    this.subscribeNativeEvents = options.subscribeAgentEvents ?? subscribeAgentEvents;
  }

  protected async call<T>(command: string, args?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const boundary = this.taskCommandBoundary(command, args, signal);
    if (boundary) await boundary;
    if (!isLocalCommand(command, args)) {
      await (engineIndependentCommands.has(command) ? this.connectRuntime() : this.ensureRuntime());
    }
    // 通道连接期间仍可能取消；只有真正调用原生命令后才进入不可自动重试的提交阶段。
    signal?.throwIfAborted();
    return this.invokeCommand(command, args, signal);
  }

  protected async callRaw<T>(
    command: string,
    body: Uint8Array,
    headers: Record<string, string>,
  ): Promise<T> {
    const boundary = this.taskCommandBoundary(command);
    if (boundary) await boundary;
    if (!localCommands.has(command)) await this.ensureRuntime();
    const finalBoundary = this.taskCommandBoundary(command);
    if (finalBoundary) await finalBoundary;
    try {
      return await this.invokeNative<T>(command, body, { headers });
    } catch (error) {
      throw normalizeNativeError(error);
    }
  }

  protected async callCancellable<T>(
    command: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal === undefined) return this.call(command, args);

    signal.throwIfAborted();
    const boundary = this.taskCommandBoundary(command, args, signal);
    if (boundary) await boundary;
    if (!isLocalCommand(command, args)) {
      await (engineIndependentCommands.has(command) ? this.connectRuntime() : this.ensureRuntime());
    }
    signal.throwIfAborted();
    const requestId = createUuid();
    let rejectCancellation: ((reason?: unknown) => void) | undefined;
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    const cancelRequest = () => {
      // 取消命令绕过运行时初始化，确保 AbortSignal 能立即到达已运行的 Rust 任务。
      void this.invokeNative("cancel_native_request", { requestId }).catch(() => undefined);
      rejectCancellation?.(signal.reason);
    };
    signal.addEventListener("abort", cancelRequest, { once: true });
    try {
      const request = this.invokeCommand<T>(command, { ...args, requestId }, signal);
      return await Promise.race([request, cancellation]);
    } finally {
      signal.removeEventListener("abort", cancelRequest);
    }
  }

  protected async invokeCommand<T>(
    command: string,
    args?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    // 真正发送前复查，防止连接等待期间切换到 ACP，或取消后仍发出旧请求。
    const boundary = this.taskCommandBoundary(command, args, signal);
    if (boundary) await boundary;
    signal?.throwIfAborted();
    try {
      return args === undefined
        ? await this.invokeNative<T>(command)
        : await this.invokeNative<T>(command, args);
    } catch (error) {
      throw normalizeNativeError(error);
    }
  }

  private taskCommandBoundary(command: string, args?: Record<string, unknown>, signal?: AbortSignal): Promise<void> | undefined {
    // 普通本地和 ACP 端口同步放行，不新增能力查询或初始化等待。
    if (!requiresLegacyTaskRuntime(command, args)) return;
    return this.applicationRuntime().then((runtime) => {
      signal?.throwIfAborted();
      if (runtime === "acp") throw new AcpLegacyTaskCommandError(command);
    });
  }
}
