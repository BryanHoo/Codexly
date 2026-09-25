export function shouldEnableWorkbenchSkills(
  capabilityAvailable: boolean,
  temporary: boolean,
): boolean {
  // Skills 依赖真实 Project 根目录，临时作用域不能请求 Project 专属能力。
  return capabilityAvailable && !temporary;
}
