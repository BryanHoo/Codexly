use std::{
    collections::{HashMap, VecDeque},
    time::{Duration, Instant},
};

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePerformanceMetricsSnapshot {
    pub projects: Vec<ProjectPerformanceMetricsSnapshot>,
    pub version: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPerformanceMetricsSnapshot {
    pub coalesced_events: u64,
    pub ipc_events_per_second: f64,
    pub merge_rate: f64,
    pub project_id: String,
    pub provider_events_received: u64,
    pub published_events: u64,
    pub queue_high_watermark: usize,
}

#[derive(Default)]
struct ProjectPerformanceMetrics {
    provider_events_received: u64,
    published_at: VecDeque<Instant>,
    published_events: u64,
    queue_high_watermark: usize,
}

#[derive(Default)]
pub(super) struct RuntimePerformanceMetrics {
    projects: HashMap<String, ProjectPerformanceMetrics>,
}

impl RuntimePerformanceMetrics {
    pub(super) fn record_delivery(
        &mut self,
        project_id: &str,
        provider_events_received: u64,
        published_events: u64,
        queue_depth: usize,
    ) {
        let project = self.projects.entry(project_id.to_owned()).or_default();
        let now = Instant::now();
        while project
            .published_at
            .front()
            .is_some_and(|published_at| now.duration_since(*published_at) > Duration::from_secs(1))
        {
            project.published_at.pop_front();
        }
        for _ in 0..published_events {
            project.published_at.push_back(now);
        }
        project.provider_events_received += provider_events_received;
        project.published_events += published_events;
        project.queue_high_watermark = project.queue_high_watermark.max(queue_depth);
    }

    pub(super) fn snapshot(&self) -> RuntimePerformanceMetricsSnapshot {
        let mut projects = self
            .projects
            .iter()
            .map(|(project_id, metrics)| {
                let coalesced_events = metrics
                    .provider_events_received
                    .saturating_sub(metrics.published_events);
                ProjectPerformanceMetricsSnapshot {
                    coalesced_events,
                    ipc_events_per_second: metrics
                        .published_at
                        .iter()
                        .filter(|published_at| published_at.elapsed() <= Duration::from_secs(1))
                        .count() as f64,
                    merge_rate: if metrics.provider_events_received == 0 {
                        0.0
                    } else {
                        coalesced_events as f64 / metrics.provider_events_received as f64
                    },
                    project_id: project_id.clone(),
                    provider_events_received: metrics.provider_events_received,
                    published_events: metrics.published_events,
                    queue_high_watermark: metrics.queue_high_watermark,
                }
            })
            .collect::<Vec<_>>();
        projects.sort_unstable_by(|left, right| left.project_id.cmp(&right.project_id));
        RuntimePerformanceMetricsSnapshot {
            projects,
            version: 1,
        }
    }
}
