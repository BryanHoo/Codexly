use super::input_queue::InputQueue;
use crate::domain::project_terminal::{BLOCK_BYTES, INPUT_QUEUE_BYTES, TerminalError};

#[test]
fn input_is_bounded_ordered_and_duplicates_do_not_write_twice() {
    let queue = InputQueue::default();
    queue.accept(1, &[1; BLOCK_BYTES]).unwrap();
    queue.accept(1, &[9; BLOCK_BYTES]).unwrap();
    assert_eq!(queue.accept(3, &[3]), Err(TerminalError::InputSequenceGap));
    for sequence in 2..=4 {
        queue
            .accept(sequence, &[sequence as u8; BLOCK_BYTES])
            .unwrap();
    }
    assert_eq!(queue.bytes(), INPUT_QUEUE_BYTES);
    assert_eq!(queue.accept(5, &[5]), Err(TerminalError::InputQueueFull));
    let block = queue.take().unwrap();
    assert_eq!(block, vec![1; BLOCK_BYTES]);
    assert_eq!(queue.bytes(), INPUT_QUEUE_BYTES);
    queue.consumed(block.len());
    queue.accept(5, &[5]).unwrap();
    assert_eq!(queue.take().unwrap(), vec![2; BLOCK_BYTES]);
}

#[test]
fn cancel_discards_unaccepted_work_and_wakes_writer() {
    use std::sync::Arc;
    let queue = Arc::new(InputQueue::default());
    let writer = queue.clone();
    let worker = std::thread::spawn(move || writer.take());
    queue.cancel();
    assert!(worker.join().unwrap().is_none());
    assert_eq!(queue.accept(1, &[1]), Err(TerminalError::OwnerClosing));
}
