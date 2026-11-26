// 原生 Node Worker 无 TS 加载器；生成保留 TypeBox 符号的 JS，并由契约测试校验。
import { AcpScheduledPlanDefinitionSchema as schema } from "../packages/protocol/src/acp-scheduled-plan.js";
const Kind = Symbol.for("TypeBox.Kind");
import { writeFileSync } from "node:fs";
function emit(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(emit).join(",") + "]";
  if (v && typeof v === "object")
    return (
      "{" +
      Reflect.ownKeys(v)
        .map((k) => {
          if (typeof k === "symbol" && k !== Kind) throw Error("Unexpected schema symbol");
          return (
            (k === Kind ? "[Kind]" : JSON.stringify(k)) +
            ":" +
            emit((v as Record<PropertyKey, unknown>)[k])
          );
        })
        .join(",") +
      "}"
    );
  return JSON.stringify(v);
}
writeFileSync(
  "packages/protocol/src/acp-scheduled-plan-schema.js",
  '// 由 ACP 计划契约生成；符号元数据供原生 Node Worker 使用，回归测试防止契约漂移。\nimport { Kind } from "@sinclair/typebox";\nexport default ' +
    emit(schema) +
    ";\n",
);
