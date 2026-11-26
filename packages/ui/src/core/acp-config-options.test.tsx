import { renderToStaticMarkup } from "react-dom/server";
import type { PropsWithChildren, SelectHTMLAttributes } from "react";
import { expect, it } from "vitest";
import { AcpConfigOptions } from "./acp-config-options.js";

const Field = ({
  label,
  description,
  children,
}: PropsWithChildren<{ label: string; description?: string }>) => (
  <label>
    {label}
    {description}
    <span>{children}</span>
  </label>
);
const Select = (props: SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} />;

it("只呈现ACP公布的布尔与分组选项，忽略未知类型及无效字段", () => {
  const markup = renderToStaticMarkup(
    <AcpConfigOptions
      Field={Field}
      Select={Select}
      onChange={() => undefined}
      options={[
        {
          id: "model",
          name: "模型",
          description: "当前模型",
          type: "select",
          currentValue: "a",
          options: [
            {
              group: "gateway",
              name: "供应商",
              options: [
                { value: "a", name: "A" },
                { value: "b", name: "B" },
              ],
            },
          ],
        },
        { id: "mode", name: "模式", type: "boolean", currentValue: false },
        { id: "future", name: "未知控件", type: "slider", currentValue: 5 },
        { id: "invalid", name: "损坏配置", type: "boolean", currentValue: "false" },
      ]}
    />,
  );
  expect(markup).toContain('aria-label="模型"');
  expect(markup).toContain('<optgroup label="供应商">');
  expect(markup).toContain('value="a" selected=""');
  expect(markup).toContain('aria-label="模式"');
  expect(markup).not.toContain("未知控件");
  expect(markup).not.toContain("损坏配置");
});

it("当前值已不在可选列表时仍展示原值，不假装选择第一项", () => {
  const markup = renderToStaticMarkup(
    <AcpConfigOptions
      Field={Field}
      Select={Select}
      onChange={() => undefined}
      options={[
        {
          id: "model",
          name: "模型",
          type: "select",
          currentValue: "retired",
          options: [{ value: "new", name: "新模型" }],
        },
      ]}
    />,
  );
  expect(markup).toContain('value="retired" selected="">retired</option>');
  expect(markup).not.toContain('value="new" selected');
});
