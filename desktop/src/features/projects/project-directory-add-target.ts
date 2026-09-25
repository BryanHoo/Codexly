export type ProjectDirectoryAddTargetState = Readonly<{
  draftPath: string | undefined;
  isPathValidated: boolean;
  requestedPath: string | undefined;
  selectedPaths: readonly string[];
  submittedPath: string | undefined;
  validatedPath: string | undefined;
}>;

export function resolveProjectDirectoryAddPaths({
  draftPath,
  isPathValidated,
  requestedPath,
  selectedPaths,
  submittedPath,
  validatedPath,
}: ProjectDirectoryAddTargetState): readonly string[] {
  if (selectedPaths.length > 0) return selectedPaths;

  // 直接输入模式只接受当前已验证的一条路径，避免与目录树的多选结果混合。
  if (
    !isPathValidated ||
    draftPath !== undefined ||
    submittedPath === undefined ||
    requestedPath !== submittedPath ||
    validatedPath === undefined
  ) {
    return [];
  }

  return [validatedPath];
}
