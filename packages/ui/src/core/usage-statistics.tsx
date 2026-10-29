import { LoadingSkeleton } from "./loading-skeleton.js";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Database,
  Info,
  RefreshCw,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import type { TokenUsageQuery, TokenUsageResponse } from "@codexly/protocol";
import { usageCalendar, usageFields, summarizeUsage } from "./usage-statistics-model.js";
import { usageStatisticsCopy } from "./usage-statistics-copy.js";
interface UsageClient {
  getTokenUsage: (query: TokenUsageQuery) => Promise<TokenUsageResponse>;
}
const emptyDays: TokenUsageResponse["days"] = [];
const fieldIcons = {
  inputTokens: ArrowDownLeft,
  outputTokens: ArrowUpRight,
  cacheReadTokens: Database,
  cacheWriteTokens: Database,
};
/** 两端共用的按需面板；没有轮询、聊天事件订阅或图表运行时，缓存最多保留五分钟。 */
export function UsageStatistics({
  client,
  language,
}: Readonly<{ client: UsageClient; language: string }>) {
  const copy = usageStatisticsCopy(language),
    id = useId();
  const currentYear = new Date().getUTCFullYear();
  const [year, setYear] = useState(currentYear);
  const [engine, setEngine] = useState<"codex" | "claude" | "all">("all");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const locale = language.startsWith("zh") ? "zh-CN" : "en-US";
  const formatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const compact = useMemo(
    () => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }),
    [locale],
  );
  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, month) =>
        new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(
          new Date(Date.UTC(year, month, 1)),
        ),
      ),
    [locale, year],
  );
  const query = { year, ...(engine === "all" ? {} : { engine }) };
  const usage = useQuery({
    queryKey: ["token-usage", year],
    queryFn: () => client.getTokenUsage({ year }),
    staleTime: 30_000,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const detail = useQuery({
    queryKey: ["token-usage-day", year, engine, selectedDay],
    queryFn: () => client.getTokenUsage({ ...query, day: selectedDay ?? "" }),
    enabled: selectedDay !== null,
    staleTime: 30_000,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  // 年度响应已经按引擎分组；共用缓存并即时筛选，避免首次切换重新请求、卸载整块统计。
  const rows = useMemo(
    () =>
      (usage.data?.days ?? emptyDays).filter((row) => engine === "all" || row.engine === engine),
    [usage.data?.days, engine],
  );
  const summary = useMemo(() => summarizeUsage(rows), [rows]);
  const calendar = useMemo(() => usageCalendar(year), [year]);
  const today = new Date().toISOString().slice(0, 10);
  useEffect(() => {
    const container = calendarRef.current;
    if (!container || !usage.isSuccess || container.scrollWidth <= container.clientWidth) return;
    // 手机初次展示最近日期；只在年份或加载状态变化时定位，不跟随每次选日重排。
    const day = year === currentYear ? today : `${String(year)}-12-31`;
    const target = container.querySelector<HTMLButtonElement>(`[data-day="${day}"]`);
    if (target)
      container.scrollLeft +=
        target.getBoundingClientRect().right - container.getBoundingClientRect().right + 24;
  }, [year, currentYear, today, usage.isSuccess]);
  const selectedRows = selectedDay ? rows.filter((row) => row.day === selectedDay) : rows;
  const selected = selectedDay ? summarizeUsage(selectedRows) : summary;
  const number = (value: number | null) => (value === null ? "—" : formatter.format(value));
  const dateLabel = (day: string) =>
    new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", timeZone: "UTC" }).format(
      new Date(`${day}T00:00:00Z`),
    );
  const changeYear = (next: number) => {
    setYear(next);
    setSelectedDay(null);
  };
  const refresh = () => {
    void usage.refetch();
    if (selectedDay) void detail.refetch();
  };
  const focusDay = selectedDay ?? (year === currentYear ? today : `${String(year)}-01-01`);
  const onCalendarKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const offset = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[event.key];
    if (offset === undefined && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const buttons = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? [],
    );
    const current = buttons.indexOf(event.currentTarget);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : Math.min(buttons.length - 1, Math.max(0, current + (offset ?? 0)));
    buttons[next]?.focus();
  };
  return (
    <section className="usage-statistics" aria-labelledby={`${id}-title`}>
      <header className="usage-heading">
        <h1 id={`${id}-title`}>{copy.title}</h1>
      </header>
      <div className="usage-toolbar">
        <div className="usage-engine-filter" role="group" aria-label={copy.engineShare}>
          {(["all", "codex", "claude"] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={engine === value}
              onClick={() => {
                setEngine(value);
              }}
            >
              {value === "all" ? copy.all : value === "codex" ? "Codex" : "Claude"}
            </button>
          ))}
        </div>
        <div className="usage-toolbar-end">
          <div className="usage-year">
            <button
              type="button"
              aria-label={copy.previous}
              disabled={year <= 2000}
              onClick={() => {
                changeYear(year - 1);
              }}
            >
              <ChevronLeft />
            </button>
            <span aria-label={copy.year}>{year}</span>
            <button
              type="button"
              aria-label={copy.next}
              disabled={year >= currentYear}
              onClick={() => {
                changeYear(year + 1);
              }}
            >
              <ChevronRight />
            </button>
          </div>
          <button
            className="usage-refresh"
            type="button"
            aria-label={copy.refresh}
            title={copy.refresh}
            disabled={usage.isFetching}
            onClick={refresh}
          >
            <RefreshCw />
          </button>
        </div>
      </div>
      {usage.isPending ? (
        <LoadingSkeleton variant="statistics" className="px-0 py-6" label={copy.loading} />
      ) : usage.isError ? (
        <div className="usage-empty" role="alert">
          <Info />
          <h2>{copy.error}</h2>
          <button type="button" onClick={refresh}>
            {copy.retry}
          </button>
        </div>
      ) : (
        <>
          <div className="usage-overview">
            <div className="usage-metric usage-total">
              <span className="usage-eyebrow">{copy.total}</span>
              <strong
                className="usage-metric-value usage-total-number"
                title={number(summary.totalTokens)}
              >
                {summary.totalTokens === null ? "0" : compact.format(summary.totalTokens)}
              </strong>
              <span className="usage-caption">Tokens</span>
            </div>
            <div className="usage-metric">
              <span className="usage-eyebrow">{copy.active}</span>
              <strong className="usage-metric-value">{summary.activeDays}</strong>
              <span className="usage-caption">{copy.days}</span>
            </div>
            <div className="usage-metric">
              <span className="usage-eyebrow">{copy.peak}</span>
              <strong className="usage-metric-value" title={number(summary.peakTokens)}>
                {compact.format(summary.peakTokens)}
              </strong>
              <span className="usage-caption">
                {summary.peakDay ? dateLabel(summary.peakDay) : copy.noPeak}
              </span>
            </div>
          </div>
          <section className="usage-card usage-activity" aria-labelledby={`${id}-activity`}>
            <div className="usage-section-heading">
              <h2 id={`${id}-activity`}>{copy.activity}</h2>
              <div className="usage-date-controls">
                <input
                  type="date"
                  aria-label={copy.selectDate}
                  value={selectedDay ?? ""}
                  min={`${String(year)}-01-01`}
                  max={year === currentYear ? today : `${String(year)}-12-31`}
                  onChange={(event) => {
                    setSelectedDay(event.currentTarget.value || null);
                  }}
                />
                {selectedDay ? (
                  <button
                    className="usage-clear-day"
                    type="button"
                    aria-label={copy.closeDay}
                    onClick={() => {
                      setSelectedDay(null);
                    }}
                  >
                    <X />
                  </button>
                ) : null}
              </div>
            </div>
            <div className="usage-calendar-scroll" ref={calendarRef}>
              <div
                className="usage-calendar-layout"
                style={{ "--usage-weeks": calendar.length / 7 } as CSSProperties}
              >
                <div className="usage-months" aria-hidden="true">
                  {months.map((month, index) => (
                    <span
                      key={month}
                      style={{
                        gridColumn:
                          Math.floor(
                            (new Date(Date.UTC(year, index, 1)).getUTCDate() -
                              1 +
                              (Date.UTC(year, index, 1) - Date.UTC(year, 0, 1)) / 86_400_000 +
                              new Date(Date.UTC(year, 0, 1)).getUTCDay()) /
                              7,
                          ) + 1,
                      }}
                    >
                      {month}
                    </span>
                  ))}
                </div>
                <div className="usage-weekdays" aria-hidden="true">
                  {Array.from({ length: 7 }, (_, day) => (
                    <span key={day}>
                      {[1, 3, 5].includes(day)
                        ? new Intl.DateTimeFormat(locale, {
                            weekday: "narrow",
                            timeZone: "UTC",
                          }).format(new Date(Date.UTC(2024, 0, 7 + day)))
                        : ""}
                    </span>
                  ))}
                </div>
                <div
                  className="usage-calendar"
                  role="group"
                  aria-label={`${String(year)} ${copy.activity}`}
                >
                  {calendar.map((day, index) => {
                    if (!day) return <span key={`padding-${String(index)}`} />;
                    const tokens = summary.days.get(day) ?? 0;
                    const level =
                      tokens <= 0
                        ? 0
                        : Math.min(
                            4,
                            Math.max(1, Math.ceil(Math.sqrt(tokens / summary.peakTokens) * 4)),
                          );
                    const label = `${day} · ${formatter.format(tokens)} ${copy.tokens}`;
                    return (
                      <button
                        type="button"
                        key={day}
                        data-day={day}
                        data-level={level}
                        data-today={day === today || undefined}
                        aria-label={label}
                        title={label}
                        aria-pressed={selectedDay === day}
                        tabIndex={day === focusDay ? 0 : -1}
                        disabled={day > today}
                        onKeyDown={(event) => {
                          onCalendarKey(event);
                        }}
                        onClick={() => {
                          setSelectedDay(day);
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="usage-calendar-footer">
              <span>{copy.zone}</span>
              <div className="usage-legend">
                <span>{copy.less}</span>
                {[0, 1, 2, 3, 4].map((level) => (
                  <i key={level} data-level={level} />
                ))}
                <span>{copy.more}</span>
              </div>
            </div>
          </section>
          {summary.activeDays === 0 ? (
            <div className="usage-empty">
              <CalendarDays />
              <h2>{copy.empty}</h2>
              <p>{copy.emptyHint}</p>
            </div>
          ) : (
            <div className="usage-secondary">
              <section className="usage-card usage-trend" aria-labelledby={`${id}-trend`}>
                <h2 id={`${id}-trend`}>{copy.monthTrend}</h2>
                <div
                  className="usage-month-chart"
                  role="img"
                  aria-label={summary.months
                    .map((value, index) => `${months[index] ?? ""}: ${number(value)}`)
                    .join(", ")}
                >
                  {summary.months.map((value, index) => (
                    <div className="usage-month-column" key={index}>
                      <div className="usage-month-track">
                        <span
                          style={{
                            height: `${String(value ? Math.max(3, (value / Math.max(...summary.months)) * 100) : 0)}%`,
                          }}
                          title={`${months[index] ?? ""} · ${number(value)} Tokens`}
                        />
                      </div>
                      <span>{index + 1}</span>
                    </div>
                  ))}
                </div>
              </section>
              <section className="usage-card usage-engines" aria-labelledby={`${id}-engines`}>
                <h2 id={`${id}-engines`}>{copy.engineShare}</h2>
                {(["codex", "claude"] as const).map((value) => (
                  <div className="usage-engine-row" key={value}>
                    <div>
                      <span className={`usage-dot usage-dot-${value}`} />
                      <span>{value === "codex" ? "Codex" : "Claude"}</span>
                      <strong title={number(summary.engines[value])}>
                        {compact.format(summary.engines[value])}
                      </strong>
                    </div>
                    <div className="usage-engine-track">
                      <span
                        data-engine={value}
                        style={{
                          width: `${String(summary.totalTokens ? (summary.engines[value] / summary.totalTokens) * 100 : 0)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </section>
            </div>
          )}
          {selectedDay || usageFields.some((field) => selected[field] !== null) ? (
            <section className="usage-card usage-details" aria-labelledby={`${id}-details`}>
              <div className="usage-section-heading">
                <h2 id={`${id}-details`}>
                  {selectedDay ? dateLabel(selectedDay) : copy.breakdown}
                </h2>
              </div>
              {selectedDay ? (
                <div className="usage-selected-total">
                  {number(selected.totalTokens ?? 0)} <span>Tokens</span>
                </div>
              ) : null}
              {usageFields.some((field) => selected[field] !== null) ? (
                <div className="usage-breakdown">
                  {usageFields.map((field) => {
                    const Icon = fieldIcons[field];
                    return (
                      <div key={field} className="usage-breakdown-item" data-field={field}>
                        <span>
                          <Icon />
                          {copy[field]}
                        </span>
                        <strong title={number(selected[field])}>
                          {selected[field] === null
                            ? "—"
                            : `${selected.partialFields.has(field) ? "≥ " : ""}${compact.format(selected[field])}`}
                        </strong>
                        <span className="usage-caption">
                          {selected[field] === null
                            ? copy.unavailable
                            : selected.partialFields.has(field)
                              ? copy.partial
                              : "Tokens"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {selectedDay ? (
                <div className="usage-task-list">
                  <div className="usage-task-list-heading">
                    <h3>{copy.taskDetail}</h3>
                    <span>{copy.tasksLimit}</span>
                  </div>
                  {detail.isPending ? (
                    <p role="status">{copy.loading}</p>
                  ) : detail.isError ? (
                    <div role="alert">
                      <p>{copy.error}</p>
                      <button type="button" onClick={() => void detail.refetch()}>
                        {copy.retry}
                      </button>
                    </div>
                  ) : detail.data.tasks.length ? (
                    detail.data.tasks.map((task) => (
                      <div className="usage-task-row" key={`${task.engine}:${task.taskId}`}>
                        <span className={`usage-dot usage-dot-${task.engine}`} />
                        <div>
                          <span title={task.title}>{task.title || copy.unknownTask}</span>
                          <small>{task.engine === "codex" ? "Codex" : "Claude"}</small>
                        </div>
                        <strong title={number(task.totalTokens)}>
                          {number(task.totalTokens)}
                          <small>Tokens</small>
                        </strong>
                      </div>
                    ))
                  ) : (
                    <p>{copy.noTasks}</p>
                  )}
                </div>
              ) : null}
            </section>
          ) : null}
          <details className="usage-info">
            <summary>
              <Info />
              {copy.about}
              <ChevronRight />
            </summary>
            <p>{copy.note}</p>
          </details>
        </>
      )}
    </section>
  );
}
