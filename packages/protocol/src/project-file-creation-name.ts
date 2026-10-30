// 新建名称采用可移植子集，确保同一个项目在 Windows、macOS 和 Linux 上都能使用。
export const projectFileCreationNamePattern =
  // oxlint-disable-next-line no-control-regex -- 文件名必须拒绝控制字符，Schema 与两端界面共用同一规则。
  /^(?!.*[. ]$)(?!(?:[Cc][Oo][Nn]|[Pp][Rr][Nn]|[Aa][Uu][Xx]|[Nn][Uu][Ll]|[Cc][Oo][Mm][1-9¹²³]|[Ll][Pp][Tt][1-9¹²³])(?:\.|$))[^/\\<>:\x00-\x1f\x7f"|?*]+$/iu
    .source;
const projectFileCreationName = new RegExp(projectFileCreationNamePattern, "u");
export function isValidProjectFileCreationName(name: string): boolean {
  return name.length <= 255 && projectFileCreationName.test(name);
}
