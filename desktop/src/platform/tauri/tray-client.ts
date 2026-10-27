import { invoke } from "./native-invoke.js";

export function getTrayIconVisible(): Promise<boolean> {
  return invoke<boolean>("get_tray_icon_visible");
}

export function setTrayIconVisible(visible: boolean): Promise<boolean> {
  return invoke<boolean>("set_tray_icon_visible", { visible });
}
