// 创建弹窗的说明与错误文案随文件树功能加载，避免扩大两端首屏语言资源。
// 平台注入当前语言与目录，共用文案不依赖任何一端的 i18n 实例。
export function getProjectFileCreationMessages(language: string | undefined, path: string) {
  return language?.startsWith("en")
    ? {
        file: "New file",
        directory: "New folder",
        create: "Create",
        description: `Create in ${path}. The name cannot contain path separators.`,
        invalidName:
          "Enter a valid name without path separators, control characters, or reserved names.",
        conflict: "A file or folder with that name already exists. Choose another name.",
        failed: "Creation failed. Check directory permissions and retry.",
      }
    : {
        file: "新建文件",
        directory: "新建文件夹",
        create: "创建",
        description: `在 ${path} 中创建，名称不能包含路径分隔符。`,
        invalidName: "请输入有效名称，避免路径分隔符、控制字符和系统保留名称。",
        conflict: "同名文件或文件夹已存在，请修改名称后重试。",
        failed: "创建失败，请检查目录权限后重试。",
      };
}
