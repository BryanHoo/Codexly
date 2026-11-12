import { Value } from "@sinclair/typebox/value";
import { ApplicationPreferencesSchema, type ApplicationPreferencesPatch } from "@codexly/protocol/application-preferences";
import type { ReadOptions, MutationOptions } from "@/platform/native-client-types.js";
import { TauriAcpPlanClient } from "./acp-plan-client.js";

/** 纯本地命令不初始化运行时；跨 IPC 结果必须符合共享偏好契约。 */
export class TauriApplicationPreferencesClient extends TauriAcpPlanClient {
  private async preferences(request: Record<string,unknown>, options: ReadOptions) {
    const value: unknown = await this.call("application_preferences_request", {request}, options.signal);
    if (!Value.Check(ApplicationPreferencesSchema,value)) throw new TypeError("Invalid application preferences response");
    return value;
  }
  getApplicationPreferences(options: ReadOptions = {}) {
    return this.preferences({type:"read"}, options);
  }
  patchApplicationPreferences(changes: ApplicationPreferencesPatch, options: MutationOptions = {}) {
    return this.preferences({type:"patch",changes},options);
  }
}
