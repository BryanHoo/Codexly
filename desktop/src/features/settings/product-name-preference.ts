import { createProductNamePreference } from "@codexly/frontend-core/product-name-preference";
import { appPreferenceStorage } from "../../platform/tauri/app-storage.js";

export const productNamePreference = createProductNamePreference(
  appPreferenceStorage,
  "codeagent:product-name:v1",
);
