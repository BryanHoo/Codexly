use std::collections::VecDeque;

pub(super) struct BoundedCapture {
    head: Vec<u8>,
    tail: VecDeque<u8>,
    head_limit: usize,
    tail_limit: usize,
    total_bytes: usize,
}

impl BoundedCapture {
    /// 标准输出是机器协议，只能保留连续前缀；首尾拼接仅用于 stderr 诊断。
    pub(super) fn prefix(limit: usize) -> Self {
        Self {
            head: Vec::with_capacity(limit.min(16 * 1024)),
            tail: VecDeque::new(),
            head_limit: limit,
            tail_limit: 0,
            total_bytes: 0,
        }
    }

    pub(super) fn new(limit: usize) -> Self {
        let head_limit = limit.div_ceil(2);
        Self {
            head: Vec::with_capacity(head_limit),
            tail: VecDeque::with_capacity(limit - head_limit),
            head_limit,
            tail_limit: limit - head_limit,
            total_bytes: 0,
        }
    }

    pub(super) fn push(&mut self, mut bytes: &[u8]) -> bool {
        self.total_bytes = self.total_bytes.saturating_add(bytes.len());
        let head_remaining = self.head_limit - self.head.len();
        let head_bytes = head_remaining.min(bytes.len());
        self.head.extend_from_slice(&bytes[..head_bytes]);
        bytes = &bytes[head_bytes..];

        if self.tail_limit > 0 {
            if bytes.len() >= self.tail_limit {
                self.tail.clear();
                self.tail.extend(&bytes[bytes.len() - self.tail_limit..]);
            } else {
                let overflow = self
                    .tail
                    .len()
                    .saturating_add(bytes.len())
                    .saturating_sub(self.tail_limit);
                self.tail.drain(..overflow);
                self.tail.extend(bytes);
            }
        }
        self.is_truncated()
    }

    pub(super) fn is_truncated(&self) -> bool {
        self.total_bytes > self.head_limit + self.tail_limit
    }

    pub(super) fn into_bytes(self) -> Vec<u8> {
        let mut bytes = self.head;
        bytes.reserve(self.tail.len());
        bytes.extend(self.tail);
        bytes
    }
}
