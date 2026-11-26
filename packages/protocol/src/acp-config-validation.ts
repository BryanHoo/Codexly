import { Value } from "@sinclair/typebox/value";
import { AcpConfigOptionSchema, type AcpConfigOption } from "./acp-service.js";

/** 校验器独立于共享 Schema，让设置页的校验实现随控件按需加载。 */
export function isAcpConfigOption(value: unknown): value is AcpConfigOption {
  return Value.Check(AcpConfigOptionSchema, value);
}
