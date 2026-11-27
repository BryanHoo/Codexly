import { agentEngineName, isAgentEngine } from "@codexly/protocol";
import type { AcpProfileClient } from "./acp-fast-mode-gate.js";
import { useContext, useEffect, useEffectEvent, useState } from "react";
import * as Popover from "radix-ui/popover";
import * as Tabs from "radix-ui/tabs";
import { Check, ChevronDown, LoaderCircle, Settings, Star } from "lucide-react";
import type { AcpConfigOption, AgentEngine } from "@codexly/protocol";
import { toast } from "./notifications.js";
import { Button } from "./button.js";
import { AgentEngineIcon } from "./agent-engine-icon.js";
import { AcpComposerConfiguration } from "./acp-composer-configuration.js";
import {
  ModelSelector,
  ModelSelectorInput,
  ModelSelectorList,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorItem,
} from "./model-selector.js";

import { AcpComposerSettingsContext } from "./acp-composer-settings.js";
type SelectOption = Extract<AcpConfigOption, { type: "select" }>;
const isModel = (option: AcpConfigOption) => option.category === "model" || option.id === "model";
const isThinking = (option: AcpConfigOption) =>
  option.category === "thought_level" ||
  /^(thinking|reasoning_effort|thought_level)$/.test(option.id);
const choices = (option: SelectOption | undefined) =>
  option?.options.flatMap((choice) =>
    "group" in choice
      ? choice.options.map((item) => ({ ...item, group: choice.name }))
      : [{ ...choice, group: "" }],
  ) ?? [];
const engineName = (engine: AgentEngine) => agentEngineName(engine);
const favoriteKey = "codexly:acp-model-favorites:v1";
interface Favorite {
  engine: AgentEngine;
  value: string;
  name: string;
  optionId: string;
}
function readFavorites(): Favorite[] {
  try {
    const raw = localStorage.getItem(favoriteKey);
    if (!raw || raw.length > 65536) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (item: unknown): item is Favorite =>
              typeof item === "object" &&
              item !== null &&
              "engine" in item &&
              "value" in item &&
              "name" in item &&
              "optionId" in item &&
              isAgentEngine(item.engine) &&
              typeof item.value === "string" &&
              typeof item.name === "string" &&
              typeof item.optionId === "string",
          )
          .slice(0, 256)
      : [];
  } catch {
    return [];
  }
}
export type AcpModelSelectorProps = Readonly<{
  engine: AgentEngine;
  engines?: readonly AgentEngine[];
  options: readonly AcpConfigOption[];
  disabled: boolean;
  loadingCurrent?: boolean;
  error: Error | null;
  language?: string;
  locked?: boolean;
  label?: string | undefined;
  selectDefaultEngine?: (engine: AgentEngine) => void;
  loadOptions?: (engine: AgentEngine, signal: AbortSignal) => Promise<readonly AcpConfigOption[]>;
  onSelect: (engine: AgentEngine, id: string, value: string) => void;
  retry?: { label: string; run: () => void };
}>;

/** 模型归属与原始 ID 一起交给宿主；标签浏览不会修改草稿或历史会话引擎。 */
export function AcpModelSelector(props: AcpModelSelectorProps) {
  const { engine, options, disabled, error, locked, language = "zh-CN" } = props;
  const zh = language === "zh-CN";
  const configure = useContext(AcpComposerSettingsContext);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<string>(engine);
  const [favorites, setFavorites] = useState(readFavorites);
  const [remote, setRemote] = useState<{
    engine: AgentEngine;
    options?: readonly AcpConfigOption[];
    error?: Error;
  }>();
  const engines = locked ? [engine] : (props.engines ?? [engine]);
  // 收藏仅保存展示元数据；实际写入仍由草稿/会话配置绑定校验，不保存凭据或默认设置。
  useEffect(() => {
    const refresh = () => {
      setFavorites(readFavorites());
    };
    window.addEventListener("storage", refresh);
    window.addEventListener(favoriteKey, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(favoriteKey, refresh);
    };
  }, []);
  const reportFailure = useEffectEvent((failure: Error) => {
    const retry = props.retry;
    return toast.error(
      failure.message,
      retry ? { duration: 0, action: { label: retry.label, onClick: retry.run } } : {},
    );
  });
  // 即使选择菜单已经关闭，阻塞发送的错误也立即可见；切换作用域时一并撤销旧重试入口。
  useEffect(() => {
    if (!error) return;
    const id = reportFailure(error);
    return () => {
      toast.dismiss(id);
    };
  }, [engine, error]);
  const load = props.loadOptions;
  useEffect(() => {
    if (
      !open ||
      tab === "favorites" ||
      tab === engine ||
      !engines.includes(tab as AgentEngine) ||
      !load
    )
      return;
    const target = tab as AgentEngine;
    const controller = new AbortController();
    setRemote({ engine: target });
    void load(target, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setRemote({ engine: target, options: result });
      },
      (reason: unknown) => {
        if (controller.signal.aborted) return;
        const failure = reason instanceof Error ? reason : new Error(String(reason));
        setRemote({ engine: target, error: failure });
        toast.error(failure.message);
      },
    );
    return () => {
      controller.abort();
    };
  }, [open, tab, engine, load]);
  const model = options.find(
    (option): option is SelectOption => isModel(option) && option.type === "select",
  );
  const selected =
    choices(model).find((item) => item.value === model?.currentValue)?.name ?? model?.currentValue;
  const target = tab === "favorites" ? engine : (tab as AgentEngine);
  const targetOptions =
    target === engine ? options : remote?.engine === target ? remote.options : undefined;
  const targetModel = targetOptions?.find(
    (option): option is SelectOption => isModel(option) && option.type === "select",
  );
  const entries: (Favorite & { group: string })[] =
    tab === "favorites"
      ? favorites
          .filter((item) => engines.includes(item.engine))
          .map((item) => ({ ...item, group: "" }))
      : targetModel
        ? choices(targetModel).map((item) => ({
            engine: target,
            optionId: targetModel.id,
            value: item.value,
            name: item.name || (zh ? "默认" : "Default"),
            group: item.group,
          }))
        : [];
  const groups = [...new Set(entries.map((item) => item.group))];
  const toggle = (entry: Favorite) => {
    const current = readFavorites();
    const exists = current.some(
      (item) =>
        item.engine === entry.engine &&
        item.value === entry.value &&
        item.optionId === entry.optionId,
    );
    const next = exists
      ? current.filter(
          (item) =>
            !(
              item.engine === entry.engine &&
              item.value === entry.value &&
              item.optionId === entry.optionId
            ),
        )
      : [...current, entry].slice(-256);
    setFavorites(next);
    try {
      localStorage.setItem(favoriteKey, JSON.stringify(next));
      window.dispatchEvent(new Event(favoriteKey));
    } catch {
      /* 隐私模式下收藏仍在当前浮层可用。 */
    }
  };
  const failure = target === engine ? error : remote?.engine === target ? remote.error : undefined;
  const loading =
    tab !== "favorites" &&
    (target === engine ? props.loadingCurrent === true : targetOptions === undefined && !failure);
  // 草稿正在读取当前 Agent 时，只锁住该 Agent。其他标签的结果可以立即选中。
  const selectionDisabled = (entryEngine: AgentEngine) =>
    disabled && (!props.loadingCurrent || entryEngine === engine);
  const label =
    props.label ?? `${engineName(engine)} / ${selected ?? (zh ? "选择模型" : "Select model")}`;
  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) setTab(engine);
      }}
    >
      <Popover.Trigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={label}
          className="min-w-0 max-w-full gap-1 bg-transparent px-1 font-normal text-muted-foreground data-[state=open]:text-foreground [&_svg]:opacity-70"
          data-acp-model-trigger=""
        >
          <AgentEngineIcon engine={engine} />
          <span className="truncate">{label}</span>
          <ChevronDown aria-hidden="true" className="size-3" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          side="top"
          sideOffset={6}
          collisionPadding={8}
          aria-label={zh ? "选择 Agent 与模型" : "Select agent and model"}
          className="z-50 flex max-h-[var(--radix-popover-content-available-height)] w-72 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-surface border border-separator bg-raised text-foreground shadow-floating outline-none"
        >
          <Tabs.Root value={tab} onValueChange={setTab} className="flex min-h-0 flex-col">
            <Tabs.List
              aria-label={zh ? "模型来源" : "Model sources"}
              className="flex gap-1 overflow-x-auto border-b border-separator px-1.5 pt-1"
            >
              {["favorites", ...engines].map((value) => (
                <Tabs.Trigger
                  key={value}
                  value={value}
                  aria-label={
                    value === "favorites"
                      ? zh
                        ? "收藏"
                        : "Favorites"
                      : engineName(value as AgentEngine)
                  }
                  className="flex h-8 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-2 text-label text-muted-foreground outline-none focus-visible:shadow-focus data-[state=active]:border-foreground data-[state=active]:text-foreground"
                >
                  {value === "favorites" ? (
                    <Star aria-hidden="true" className="size-3.5" />
                  ) : (
                    <AgentEngineIcon engine={value as AgentEngine} />
                  )}
                  {value === "favorites"
                    ? zh
                      ? "收藏"
                      : "Favorites"
                    : engineName(value as AgentEngine)}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            <Tabs.Content value={tab} className="flex min-h-0 flex-col">
              <ModelSelector key={tab} label={zh ? "模型" : "Models"}>
                <ModelSelectorInput
                  autoFocus
                  aria-label={zh ? "搜索模型提供商与模型" : "Search providers and models"}
                  placeholder={zh ? "搜索模型" : "Search models"}
                />
                {loading ? (
                  <div
                    role="status"
                    className="flex items-center justify-center gap-2 p-6 text-caption text-muted-foreground"
                  >
                    <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
                    {zh ? "正在加载模型…" : "Loading models…"}
                  </div>
                ) : failure && props.retry && target === engine ? (
                  <Button type="button" variant="ghost" onClick={props.retry.run}>
                    {props.retry.label}
                  </Button>
                ) : null}
                <ModelSelectorList>
                  {!loading && !failure ? (
                    <ModelSelectorEmpty>
                      {tab === "favorites"
                        ? zh
                          ? "暂无收藏"
                          : "No favorites"
                        : zh
                          ? "未找到模型"
                          : "No models found"}
                    </ModelSelectorEmpty>
                  ) : null}
                  {groups.map((group) => (
                    <ModelSelectorGroup key={group} heading={group || undefined}>
                      {entries
                        .filter((entry) => entry.group === group)
                        .map((entry) => {
                          const favorite = favorites.some(
                            (item) =>
                              item.engine === entry.engine &&
                              item.value === entry.value &&
                              item.optionId === entry.optionId,
                          );
                          return (
                            <div
                              key={`${entry.engine}:${entry.optionId}:${entry.value}`}
                              className="flex items-center gap-0.5 [&:has([cmdk-item][hidden])]:hidden [&:not(:has([cmdk-item]))]:hidden"
                            >
                              <ModelSelectorItem
                                value={`${entry.engine} ${entry.name} ${entry.value}`}
                                keywords={[group]}
                                disabled={selectionDisabled(entry.engine)}
                                onSelect={() => {
                                  if (locked && entry.engine !== engine) return;
                                  props.onSelect(entry.engine, entry.optionId, entry.value);
                                  setOpen(false);
                                }}
                              >
                                <AgentEngineIcon engine={entry.engine} />
                                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                                {entry.engine === engine && entry.value === model?.currentValue ? (
                                  <Check aria-hidden="true" className="size-3.5" />
                                ) : null}
                              </ModelSelectorItem>
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`${favorite ? (zh ? "取消收藏" : "Unstar") : zh ? "收藏" : "Star"} ${entry.name}`}
                                aria-pressed={favorite}
                                onClick={() => {
                                  toggle(entry);
                                }}
                              >
                                <Star
                                  aria-hidden="true"
                                  className={`size-3.5 ${favorite ? "fill-current text-brand" : ""}`}
                                />
                              </Button>
                            </div>
                          );
                        })}
                    </ModelSelectorGroup>
                  ))}
                </ModelSelectorList>
              </ModelSelector>
            </Tabs.Content>
          </Tabs.Root>
          <div className="border-t border-separator p-1">
            {props.selectDefaultEngine &&
            target !== engine &&
            !loading &&
            !failure &&
            entries.length === 0 ? (
              <Button
                type="button"
                variant="ghost"
                disabled={selectionDisabled(target)}
                onClick={() => {
                  props.selectDefaultEngine?.(target);
                  setOpen(false);
                }}
              >
                {zh
                  ? `使用 ${engineName(target)} 的默认模型`
                  : `Use ${engineName(target)} defaults`}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              contentAlign="start"
              className="h-7 w-full px-2 text-label"
              disabled={!configure}
              onClick={() => {
                setOpen(false);
                configure?.();
              }}
            >
              <Settings aria-hidden="true" className="size-3.5" />
              {zh ? "配置 Agent" : "Configure agents"}
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

type AcpComposerControlsProps = Readonly<{
  options: readonly AcpConfigOption[];
  disabled: boolean;
  error: Error | null;
  label: string;
  engine?: AgentEngine | undefined;
  client?: AcpProfileClient | undefined;
  language?: string;
  onChange: (id: string, value: string | boolean) => void;
  retry?: { label: string; run: () => void };
}>;
/** 权限等配置留在左侧，思考独立交给右侧常驻控件。 */
export function AcpComposerLeading(props: AcpComposerControlsProps) {
  return (
    <AcpComposerConfiguration
      {...props}
      options={props.options.filter((option) => !isModel(option) && !isThinking(option))}
    />
  );
}
export function AcpComposerReasoning(props: AcpComposerControlsProps) {
  return <AcpComposerConfiguration {...props} options={props.options.filter(isThinking)} />;
}
