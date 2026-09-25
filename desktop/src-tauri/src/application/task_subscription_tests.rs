use std::time::Duration;

use super::task_subscription::{TaskSubscriptionLeases, unsubscribe_retry_delay};

#[test]
fn rust_lease_generation_cancels_a_pending_unsubscribe() {
    let mut leases = TaskSubscriptionLeases::default();
    let generation = leases.release("task-1");
    assert!(leases.is_current("task-1", generation));

    leases.retain("task-1");
    assert!(!leases.is_current("task-1", generation));
}

#[test]
fn rust_unsubscribe_retry_uses_bounded_exponential_backoff() {
    assert_eq!(unsubscribe_retry_delay(0), Duration::from_secs(1));
    assert_eq!(unsubscribe_retry_delay(4), Duration::from_secs(16));
    assert_eq!(unsubscribe_retry_delay(20), Duration::from_secs(30));
}
