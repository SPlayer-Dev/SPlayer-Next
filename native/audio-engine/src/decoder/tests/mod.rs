use super::*;
use crate::decoder::buffer::PopResult;

#[test]
fn panic_marks_decode_failed_and_finishes_source() {
    let shared = Shared::new(48_000, DEFAULT_OUTPUT_CHANNELS);

    run_decode_safely(&shared, || panic!("模拟解码 panic"));

    assert!(shared.is_decode_failed());
    assert!(shared.pop_decoded().is_none());
    shared.mark_output_eof();
    assert!(matches!(shared.try_pop(), PopResult::Finished));
}

#[test]
fn normal_completion_does_not_mark_decode_failed() {
    let shared = Shared::new(48_000, DEFAULT_OUTPUT_CHANNELS);

    run_decode_safely(&shared, || {});

    assert!(!shared.is_decode_failed());
    assert!(shared.pop_decoded().is_none());
    shared.mark_output_eof();
    assert!(matches!(shared.try_pop(), PopResult::Finished));
}
