import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/.cache/**",
      "**/.agents/**",
      "**/node_modules/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  eslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    rules: {
      // 生产模块保持单一职责；测试场景和 fixture 在下方集中豁免。
      "max-lines": ["error", { max: 500, skipBlankLines: false, skipComments: false }],
    },
  },
  {
    files: [
      "**/*.d.ts",
      "**/*.{test,spec}.{js,mjs,cjs,ts,tsx}",
      "**/test/fixtures/**/*.{js,mjs,cjs,ts,tsx}",
      "tests/e2e/**/*.{js,mjs,cjs,ts,tsx}",
    ],
    rules: {
      "max-lines": "off",
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-exports": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-import-type-side-effects": "error",
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    extends: [jsxA11y.flatConfigs.recommended],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    // React 专属规则只检查浏览器源码，覆盖 Hook 调用、依赖完整性和基础 JSX 无障碍问题。
    rules: {
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
    },
  },
  prettier,
);
