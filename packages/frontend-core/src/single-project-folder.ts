/** 两端目录选择共用单选规则：选择新文件夹时替换旧选择。 */
export function setProjectRootPathChecked(
  paths: readonly string[],
  path: string,
  checked: boolean,
): readonly string[] {
  if (checked) return paths.length === 1 && paths[0] === path ? paths : [path];
  return paths.filter((selected) => selected !== path).slice(0, 1);
}
