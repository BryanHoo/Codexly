use chrono::{Datelike, Duration, NaiveDate, TimeZone};
use rrule::{Frequency, RRuleSet, Tz};

/// 无限规则跳到当前周期之前，保留原始间隔相位和已经验证的 BY* 默认值。
/// COUNT 必须从原始起点计数，因此继续使用原始集合。
pub(super) fn seek_recurrence(set: RRuleSet, after: chrono::DateTime<Tz>) -> RRuleSet {
    let Some(rule) = set.get_rrule().first() else {
        return set;
    };
    if rule.get_count().is_some() {
        return set;
    }
    let start = *set.get_dt_start();
    let local_start = start.naive_local();
    let local_after = after.with_timezone(&start.timezone()).naive_local();
    if local_after <= local_start {
        return set;
    }
    let interval = i64::from(rule.get_interval());
    let elapsed = local_after - local_start;
    // 留出一个完整周期，避免月内多选、周起点或夏令时边界漏掉当前周期的候选。
    let periods = |value: i64| (value / interval - 1).max(0) * interval;
    let candidate = match rule.get_freq() {
        Frequency::Secondly => {
            local_start.checked_add_signed(Duration::seconds(periods(elapsed.num_seconds())))
        }
        Frequency::Minutely => {
            local_start.checked_add_signed(Duration::minutes(periods(elapsed.num_minutes())))
        }
        Frequency::Hourly => {
            local_start.checked_add_signed(Duration::hours(periods(elapsed.num_hours())))
        }
        Frequency::Daily => {
            local_start.checked_add_signed(Duration::days(periods(elapsed.num_days())))
        }
        Frequency::Weekly => {
            local_start.checked_add_signed(Duration::weeks(periods(elapsed.num_weeks())))
        }
        Frequency::Monthly => {
            let months = i64::from(local_after.year() - local_start.year()) * 12
                + i64::from(local_after.month())
                - i64::from(local_start.month());
            let index = i64::from(local_start.year()) * 12
                + i64::from(local_start.month0())
                + periods(months);
            NaiveDate::from_ymd_opt((index / 12) as i32, (index % 12 + 1) as u32, 1)
                .and_then(|date| date.and_hms_opt(0, 0, 0))
        }
        Frequency::Yearly => {
            let year = i64::from(local_start.year())
                + periods(i64::from(local_after.year() - local_start.year()));
            NaiveDate::from_ymd_opt(year as i32, 1, 1).and_then(|date| date.and_hms_opt(0, 0, 0))
        }
    };
    let Some(candidate) =
        candidate.and_then(|value| start.timezone().from_local_datetime(&value).earliest())
    else {
        return set;
    };
    if candidate <= start {
        return set;
    }
    // 使用已校验规则而非重新 parse，避免新起点覆盖隐式星期、月日或执行时刻。
    RRuleSet::new(candidate).rrule(rule.clone())
}
