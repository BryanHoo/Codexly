import { createContext } from "react";

/** 宿主注入 ACP 设置导航，避免共享选择器依赖具体应用路由。 */
export const AcpComposerSettingsContext = createContext<(() => void) | undefined>(undefined);
