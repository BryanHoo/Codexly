pub(crate) fn encode_lower_hex(bytes: impl AsRef<[u8]>) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";

    let bytes = bytes.as_ref();
    let mut encoded = String::with_capacity(bytes.len() * 2);
    // 查表写入可避免为每个字节创建临时格式化字符串。
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::encode_lower_hex;

    #[test]
    fn encode_lower_hex_should_preserve_leading_zeroes() {
        assert_eq!(encode_lower_hex([0x00, 0x0f, 0x10, 0xff]), "000f10ff");
    }

    #[test]
    fn encode_lower_hex_should_encode_empty_input() {
        assert_eq!(encode_lower_hex([]), "");
    }
}
