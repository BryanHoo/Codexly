import { ComposerCommandMenu as SharedComposerCommandMenu } from "@codexly/ui/core/composer-command-menu";

import { useTranslation } from "../../../i18n/i18n.js";
import { PromptCommandIcon } from "./workbench-composer-toolbar.js";
import type { WorkbenchComposerViewProps } from "./workbench-composer-view-contracts.js";

export function ComposerCommandMenu({ props }: Readonly<{ props: WorkbenchComposerViewProps }>) {
  const { t } = useTranslation("workbench");
  // 命令执行与平台图标由本端提供，菜单分组、索引和禁用行为只维护一份。
  return <SharedComposerCommandMenu CommandIcon={PromptCommandIcon} props={props} t={t} />;
}
