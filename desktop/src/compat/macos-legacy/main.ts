import "./styles.css";
import { installLegacyFormSubmit } from "./form-submit.js";

installLegacyFormSubmit();

// 兼容样式先于应用加载；标准 API 补丁由 Vite 按 Safari 15.5 的实际使用自动生成。
void import("../../main.js");
