import { createHash } from "node:crypto";
import { join } from "node:path";

/** 项目及运行身份只参与散列，不能变成目录片段；不会扫描或删除其他归属。 */
export function ownedAttachmentDirectory(
  directory: string,
  project: string,
  owner: string,
): string {
  if (!project.length || project.length > 128 || !owner.length || owner.length > 256)
    throw new Error("Invalid attachment cache owner");
  return join(
    directory,
    "acp-plans",
    createHash("sha256")
      .update(JSON.stringify([project, owner]))
      .digest("hex"),
  );
}
