import type { AgentEngine, AgentEngineProfile, ClaudeSettings, ConfigureCustomProviderRequest } from "@codexly/protocol";
import type { MutationOptions, ReadOptions } from "@/platform/native-client-types.js";
import type {
  AgentCapabilities,
  AppInfoResponse,
  AppUpdateInstallProgress,
  HealthResponse,
  EventStreamMetricsResponse,
  ExportDiagnosticsResponse,
  UploadAgentFeedbackRequest,
  UploadAgentFeedbackResponse,
  WorkbenchPetCatalogResponse,
  WorkbenchPetDownloadResponse,
} from "@/protocol/index.js";
import { Channel } from "@tauri-apps/api/core";
import type { BingWallpaper, DownloadWorkbenchBackgroundResponse, WorkbenchBackgroundResponse } from "@/protocol/workbench-background.js";

import { TauriCatalogClient } from "./catalog-client.js";
import {
  mapNativePet,
  type NativePetCatalogResponse,
  type NativePetDownloadResponse,
} from "./workbench-pet-catalog.js";

export type AppUpdateInstallOptions = MutationOptions &
  Readonly<{ onProgress?: (progress: AppUpdateInstallProgress) => void }>;

export class TauriRuntimeClient extends TauriCatalogClient {
  public async getEngineProfile(engine: AgentEngine, projectId?: string): Promise<AgentEngineProfile> {
    if (engine !== "claude") return { engine, capabilities: await this.getCapabilities(), models: { data: [...(await this.listModels()).data], nextCursor: null }, commands: [], connection: await this.getProviderConnection() };
    return this.invokeCommand("claude_engine_request", { method: "profile", projectId, params: {} });
  }
  public async configureEngine(engine: AgentEngine, input: ConfigureCustomProviderRequest): Promise<unknown> {
    if (engine !== "claude") throw new Error("Use Codex provider settings");
    return this.invokeCommand("claude_engine_request", { method: "configure", params: input });
  }
  public async disconnectEngine(engine: AgentEngine): Promise<unknown> {
    if (engine !== "claude") throw new Error("Use Codex provider settings");
    return this.invokeCommand("claude_engine_request", { method: "disconnect", params: {} });
  }
  public async getClaudeSettings(): Promise<ClaudeSettings> {
    return this.invokeCommand("claude_engine_request", { method: "settings.read", params: {} });
  }
  public async updateClaudeSettings(settings: ClaudeSettings): Promise<ClaudeSettings> {
    return this.invokeCommand("claude_engine_request", { method: "settings.write", params: settings });
  }

  public async exportDiagnostics(): Promise<ExportDiagnosticsResponse> {
    // 运行时故障正是导出日志的主要场景，因此该命令不等待 Codex 初始化。
    return this.invokeCommand("export_diagnostics");
  }

  public async getPerformanceMetrics(): Promise<EventStreamMetricsResponse> {
    return this.call("get_runtime_performance_metrics");
  }
  public async getHealth(_options: ReadOptions = {}): Promise<HealthResponse> {
    await this.ensureRuntime();
    return { status: "ok", version: 1 };
  }

  public async getCapabilities(_options: ReadOptions = {}): Promise<AgentCapabilities> {
    // 静态能力声明不依赖进程；Claude 单引擎启动不能因工作区读取元数据而启动 Codex。
    return {
      feedback: { upload: true },
      goals: { clear: true, read: true, update: true },
      provider: "codex",
      skills: { list: true, use: true },
      tasks: { fork: true, list: true, read: true, start: true },
      turns: { compact: true, interrupt: true, review: true, start: true, steer: true },
    };
  }

  public async uploadFeedback(
    projectId: string,
    taskId: string,
    input: UploadAgentFeedbackRequest,
    _options: MutationOptions = {},
  ): Promise<UploadAgentFeedbackResponse> {
    return this.call("upload_feedback", { input, projectId, taskId });
  }

  public async getAppInfo(_options: ReadOptions = {}): Promise<AppInfoResponse> {
    return this.call("get_app_info");
  }

  public async installAppUpdate(
    version: string,
    options: AppUpdateInstallOptions = {},
  ): Promise<void> {
    let latestSequence = 0;
    const progressChannel = new Channel<AppUpdateInstallProgress>((progress) => {
      // 原生下载事件可能排队到达，只向 React 投影最新的单调进度。
      if (progress.sequence <= latestSequence) return;
      latestSequence = progress.sequence;
      options.onProgress?.(progress);
    });
    await this.call<void>("install_app_update", { onProgress: progressChannel, version });
  }

  public async getWorkbenchBackground(day?: string, thumbnail = false): Promise<WorkbenchBackgroundResponse> {
    return this.invokeCommand("get_workbench_background", { day: day ?? null, thumbnail });
  }

  public async listWorkbenchBackgrounds(): Promise<readonly BingWallpaper[]> {
    return this.invokeCommand("list_workbench_backgrounds");
  }

  public async downloadWorkbenchBackground(day: string): Promise<DownloadWorkbenchBackgroundResponse> {
    return this.invokeCommand("download_workbench_background", { day });
  }

  public async listWorkbenchPets(_options: ReadOptions = {}): Promise<WorkbenchPetCatalogResponse> {
    const response = await this.call<NativePetCatalogResponse>("list_workbench_pets");
    return { data: response.data.map(mapNativePet) };
  }

  public async downloadWorkbenchPet(
    petId: string,
    _options: MutationOptions = {},
  ): Promise<WorkbenchPetDownloadResponse> {
    const response = await this.call<NativePetDownloadResponse>("download_workbench_pet", {
      petId,
    });
    return { data: mapNativePet(response.data) };
  }
}
