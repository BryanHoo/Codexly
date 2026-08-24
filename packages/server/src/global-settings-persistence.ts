export const FAST_MODE_SETTING_MIGRATION = {
  name: "add_fast_mode_setting",
  sql: `
    ALTER TABLE global_settings
      ADD COLUMN fast_mode INTEGER NOT NULL DEFAULT 0
      CHECK (fast_mode IN (0, 1));
  `,
  version: 12,
} as const;

export const PRESERVE_LEGACY_GLOBAL_SETTINGS_COLUMNS_MIGRATION = {
  name: "preserve_legacy_global_settings_columns",
  // version 13 已被使用，保留版本号但不再删除旧版本仍会读取的列。
  sql: "SELECT 1;",
  version: 13,
} as const;

export const GLOBAL_SETTINGS_MIGRATIONS = [
  FAST_MODE_SETTING_MIGRATION,
  PRESERVE_LEGACY_GLOBAL_SETTINGS_COLUMNS_MIGRATION,
] as const;
