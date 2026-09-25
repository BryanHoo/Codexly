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
    await this.ensureRuntime();
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
