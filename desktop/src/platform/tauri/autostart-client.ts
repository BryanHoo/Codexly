import { invoke } from "./native-invoke.js";

/** 直接查询系统启动项，避免本地偏好与用户在系统设置中的修改不一致。 */
export function getAutostartEnabled(): Promise<boolean> {
  return invoke<boolean>("plugin:autostart|is_enabled");
}

export async function setAutostartEnabled(enabled: boolean): Promise<boolean> {
  await invoke<void>(`plugin:autostart|${enabled ? "enable" : "disable"}`);
  // 系统写入后再次确认；失败必须传回界面，不能仅凭用户点击显示已开启。
  const actual = await getAutostartEnabled();
  if (actual !== enabled) throw new Error("AUTOSTART_STATE_MISMATCH");
  return actual;
}
