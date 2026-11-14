import { isAcpFastModeOption } from "@codexly/frontend-core/acp-config-visibility";
import { AcpFastModeGate, type AcpProfileClient } from "./acp-fast-mode-gate.js";
import type { AcpConfigOption, AgentEngine } from "@codexly/protocol";
import { acpConfigLabel } from "@codexly/frontend-core/acp-config-labels";
import { CompactSelector } from "./compact-selector.js";

/** 工具栏只展示当前值和可选项；说明留在设置页，原始 ID 与值不参与翻译。 */
export function AcpComposerConfiguration({
  options,
  disabled,
  language = "zh-CN",
  onChange,
  engine,
  client,
}: {
  options: readonly AcpConfigOption[];
  engine?: AgentEngine | undefined;
  client?: AcpProfileClient | undefined;
  disabled: boolean;
  language?: string;
  onChange: (id: string, value: string | boolean) => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-0.5" data-acp-configuration="">
      {options.map((option) => {
        const label = acpConfigLabel(option.name, language);
        const control =
          option.type === "select" ? (
            <CompactSelector
              key={option.id}
              label={label}
              disabled={disabled}
              value={option.currentValue}
              options={option.options.flatMap((choice) =>
                ("group" in choice ? choice.options : [choice]).map((item) => ({
                  value: item.value,
                  label: item.name
                    ? acpConfigLabel(item.name, language)
                    : language === "zh-CN"
                      ? "默认"
                      : "Default",
                })),
              )}
              onValueChange={(value) => {
                onChange(option.id, value);
              }}
            />
          ) : (
            <CompactSelector
              key={option.id}
              label={label}
              prefix={label}
              disabled={disabled}
              value={String(option.currentValue)}
              options={[
                { value: "true", label: language === "zh-CN" ? "开启" : "On" },
                { value: "false", label: language === "zh-CN" ? "关闭" : "Off" },
              ]}
              onValueChange={(value) => {
                onChange(option.id, value === "true");
              }}
            />
          );
        return isAcpFastModeOption(option) ? (
          <AcpFastModeGate key={option.id} engine={engine} client={client}>
            {control}
          </AcpFastModeGate>
        ) : (
          control
        );
      })}
    </div>
  );
}
