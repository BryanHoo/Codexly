import { build } from "tsup";
import configuration from "../tsup.config.ts";

/** 旧协议回归夹具独立编译到开发目录，不能为运行测试把旧执行器重新发布给用户。 */
export default async function prepareE2e() {
  await build({
    ...configuration,
    config: false,
    entry: { codex: "packages/provider-codex/src/index.ts" },
    outDir: ".artifacts/e2e",
    clean: true,
  });
}
