import {
  ApplicationPreferencesSchema,
  type ApplicationPreferencesPatch,
} from "@codexly/protocol/application-preferences";
import { AcpPlanHttpClient } from "./http-client-acp-plans.js";
import type { ReadOptions, MutationOptions } from "./http-client-transport.js";
/** 应用偏好采用独立契约，不能绕回旧全局设置与厂商模型目录。 */
export class ApplicationPreferencesHttpClient extends AcpPlanHttpClient {
  getApplicationPreferences(options: ReadOptions = {}) {
    return this.read("/v1/application-preferences", ApplicationPreferencesSchema, options);
  }
  patchApplicationPreferences(changes: ApplicationPreferencesPatch, options: MutationOptions = {}) {
    return this.mutation(
      "/v1/application-preferences",
      changes,
      ApplicationPreferencesSchema,
      options,
      "PATCH",
    );
  }
}
